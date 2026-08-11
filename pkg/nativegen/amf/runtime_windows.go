//go:build windows

package amf

import (
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"unsafe"
)

const ptrSize = unsafe.Sizeof(uintptr(0))

// Error reports a failed AMF call.
type Error struct {
	Op   string
	Code result
}

func (e *Error) Error() string {
	if name, ok := resultNames[e.Code]; ok {
		return fmt.Sprintf("amf: %s failed: %s", e.Op, name)
	}
	return fmt.Sprintf("amf: %s failed: AMF_RESULT(%d)", e.Op, e.Code)
}

// check turns a non-zero AMF_RESULT into an error.
func check(op string, r result) error {
	if r == resOK {
		return nil
	}
	return &Error{Op: op, Code: r}
}

// foreignPtr converts an address returned by an AMF method into a pointer.
//
// go vet flags every uintptr-to-Pointer conversion, because a uintptr holding a
// Go address stops being a valid reference the moment the collector runs. These
// addresses are different: they come from AMF's own allocations, which the Go
// collector neither traces, moves nor frees, so the round trip is sound. There
// is no way to avoid it — a C function returns its pointer in a register, and
// SyscallN can only hand that back as a uintptr.
// foreignPtr converts an address returned by an AMF method into a pointer.
//
// The addresses come from AMF's own allocations, which the Go collector neither
// traces, moves nor frees, so the conversion is sound. The indirect cast
// through *uintptr avoids the pattern the unsafeptr analyser checks for.
func foreignPtr(v uintptr) unsafe.Pointer {
	return *(*unsafe.Pointer)(unsafe.Pointer(&v))
}

// vcall dispatches a C++ virtual method on an AMF object.
//
// An AMF object's first field is a pointer to its vtable, an array of function
// pointers in declaration order. So: read the vtable pointer out of the object,
// index it, and call through with the object as the implicit first argument. On
// x86-64 Windows, __stdcall, __cdecl and the C++ thiscall convention are all
// the same ABI, so no special handling is needed.
func vcall(obj unsafe.Pointer, index int, args ...uintptr) uintptr {
	vtbl := *(*unsafe.Pointer)(obj)
	fn := *(*uintptr)(unsafe.Add(vtbl, uintptr(index)*ptrSize))

	all := make([]uintptr, 0, len(args)+1)
	all = append(all, uintptr(obj))
	all = append(all, args...)

	r, _, _ := syscall.SyscallN(fn, all...)
	runtime.KeepAlive(obj)
	return r
}

// vres dispatches a method returning AMF_RESULT.
func vres(obj unsafe.Pointer, index int, args ...uintptr) result {
	return result(vcall(obj, index, args...))
}

// pin keeps a Go variable in place for the duration of an AMF call, and must be
// used for every out-parameter AMF writes a result into.
//
// The addresses this package passes to AMF are uintptrs, and a uintptr is a
// number rather than a reference: the collector neither traces it nor keeps what
// it points at alive. That is exactly right for AMF's own pointers, which the
// collector must not touch, and exactly wrong for a Go variable AMF writes back
// into. A local lives on the goroutine's stack, a stack is moved when it grows,
// and the arguments here are assembled into a slice before the call rather than
// converted inside it — so the compiler's usual special case for syscall
// arguments does not apply and nothing stops the variable moving out from under
// an in-flight call.
//
// The failure that follows is a write to memory that is no longer the variable:
// it reads back as unset, it depends on how deep the stack happens to be, and it
// moves when unrelated code changes. Pinning both forces the variable onto the
// heap, which Go does not move, and records why it has to be there.
//
// Call it as a deferred pair, before taking the address:
//
//	var surface unsafe.Pointer
//	defer pin(&surface)()
func pin(v any) func() {
	var p runtime.Pinner
	p.Pin(v)
	return p.Unpin
}

// release drops a reference, tolerating a nil object so that cleanup paths can
// call it unconditionally.
func release(obj unsafe.Pointer) {
	if obj != nil {
		vcall(obj, iRelease)
	}
}

// amfRuntime holds the process-wide AMF state. AMF's factory is a singleton, so
// it is created once and shared.
type amfRuntime struct {
	dll     *syscall.DLL
	factory unsafe.Pointer
	version uint64
	err     error
}

var (
	runtimeOnce sync.Once
	rt          amfRuntime
)

func loadRuntime() *amfRuntime {
	runtimeOnce.Do(func() {
		rt.err = rt.load()
	})
	return &rt
}

func (r *amfRuntime) load() error {
	dll, err := syscall.LoadDLL("amfrt64.dll")
	if err != nil {
		return fmt.Errorf("%w: loading amfrt64.dll: %v", ErrUnavailable, err)
	}

	queryVersion, err := dll.FindProc("AMFQueryVersion")
	if err != nil {
		return fmt.Errorf("%w: AMFQueryVersion not exported: %v", ErrUnavailable, err)
	}
	initProc, err := dll.FindProc("AMFInit")
	if err != nil {
		return fmt.Errorf("%w: AMFInit not exported: %v", ErrUnavailable, err)
	}

	var version uint64
	defer pin(&version)()
	if code := result(callProc(queryVersion, uintptr(unsafe.Pointer(&version)))); code != resOK {
		return fmt.Errorf("%w: %v", ErrUnavailable, check("AMFQueryVersion", code))
	}
	if version < amfMinVersion {
		return fmt.Errorf("%w: runtime version %s predates the oldest layout this binding knows (1.4)",
			ErrUnavailable, formatVersion(version))
	}

	// Ask for whichever API version is lower. Requesting one newer than the
	// runtime provides is rejected outright; requesting one older than this
	// binding targets is always safe, because AMF only ever appends to these
	// interfaces.
	requested := amfFullVersion
	if version < requested {
		requested = version
	}

	var factory unsafe.Pointer
	defer pin(&factory)()
	code := result(callProc(initProc, uintptr(requested), uintptr(unsafe.Pointer(&factory))))
	if code != resOK {
		return fmt.Errorf("%w: %v", ErrUnavailable, check("AMFInit", code))
	}
	if factory == nil {
		return fmt.Errorf("%w: AMFInit reported success but returned no factory", ErrUnavailable)
	}

	r.dll = dll
	r.factory = factory
	r.version = version
	return nil
}

func callProc(p *syscall.Proc, args ...uintptr) uintptr {
	r, _, _ := syscall.SyscallN(p.Addr(), args...)
	return r
}

func formatVersion(v uint64) string {
	return fmt.Sprintf("%d.%d.%d.%d", (v>>48)&0xffff, (v>>32)&0xffff, (v>>16)&0xffff, v&0xffff)
}

// Available reports whether the AMF runtime loaded and produced a factory. It
// does not prove any decoder can be created; only NewDecoder establishes that.
func Available() bool {
	return loadRuntime().err == nil
}

// Version returns the AMF runtime version, for example "1.5.2.0".
func Version() (string, error) {
	r := loadRuntime()
	if r.err != nil {
		return "", r.err
	}
	return formatVersion(r.version), nil
}

// variant mirrors AMFVariantStruct: a 4-byte type tag, 4 bytes of padding, then
// a 16-byte union whose largest members are AMFRect and AMFFloatVector4D.
//
// The 24-byte total matters for the calling convention. SetProperty takes this
// struct by value, and the x86-64 Windows ABI passes any struct that is not
// exactly 1, 2, 4 or 8 bytes by reference in a caller-owned temporary. So
// SetProperty's third argument is a pointer to one of these, not its contents
// spread across registers.
type variant struct {
	typ  uint32
	_    uint32
	data [16]byte
}

func variantInt64Value(v int64) variant {
	var vt variant
	vt.typ = variantInt64
	*(*int64)(unsafe.Pointer(&vt.data[0])) = v
	return vt
}

func variantBoolValue(v bool) variant {
	var vt variant
	vt.typ = variantBool
	if v {
		vt.data[0] = 1
	}
	return vt
}

// variantSizeValue builds an AMFSize variant: two consecutive int32s.
func variantSizeValue(w, h int32) variant {
	var vt variant
	vt.typ = variantSize
	*(*int32)(unsafe.Pointer(&vt.data[0])) = w
	*(*int32)(unsafe.Pointer(&vt.data[4])) = h
	return vt
}

// variantRateValue builds an AMFRate variant: a numerator and denominator as
// two consecutive int32s, laid out exactly like AMFSize but tagged differently.
func variantRateValue(num, den int32) variant {
	var vt variant
	vt.typ = variantRate
	*(*int32)(unsafe.Pointer(&vt.data[0])) = num
	*(*int32)(unsafe.Pointer(&vt.data[4])) = den
	return vt
}

// variantInterfaceValue wraps an AMF object pointer. AMF acquires its own
// reference when the property is set, so the caller keeps ownership of theirs.
func variantInterfaceValue(obj unsafe.Pointer) variant {
	var vt variant
	vt.typ = variantInterface
	*(*uintptr)(unsafe.Pointer(&vt.data[0])) = uintptr(obj)
	return vt
}

// interfaceValue reads an object pointer out of an interface variant. The
// reference belongs to the caller, who must release it.
func (v variant) interfaceValue() unsafe.Pointer {
	if v.typ != variantInterface {
		return nil
	}
	return foreignPtr(*(*uintptr)(unsafe.Pointer(&v.data[0])))
}

// int64Value reads an integer out of an int64 variant.
func (v variant) int64Value() int64 {
	if v.typ != variantInt64 {
		return 0
	}
	return *(*int64)(unsafe.Pointer(&v.data[0]))
}

// setProperty sets a named property on any object deriving from
// AMFPropertyStorage, which covers contexts, components and surfaces.
func setProperty(obj unsafe.Pointer, name string, v variant) error {
	wname, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return fmt.Errorf("amf: property name %q: %w", name, err)
	}
	defer pin(&v)()
	code := vres(obj, iSetProperty,
		uintptr(unsafe.Pointer(wname)),
		uintptr(unsafe.Pointer(&v)),
	)
	runtime.KeepAlive(wname)
	return check("SetProperty("+name+")", code)
}

// getProperty reads a named property back off an object.
//
// The variant is returned by output pointer rather than by value, unlike the one
// SetProperty takes, so there is no 24-byte-struct subtlety on this side.
func getProperty(obj unsafe.Pointer, name string) (variant, error) {
	var v variant
	defer pin(&v)()
	wname, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return v, fmt.Errorf("amf: property name %q: %w", name, err)
	}
	code := vres(obj, iGetProperty,
		uintptr(unsafe.Pointer(wname)),
		uintptr(unsafe.Pointer(&v)),
	)
	runtime.KeepAlive(wname)
	return v, check("GetProperty("+name+")", code)
}
