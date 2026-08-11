package mp4

import (
	"encoding/binary"
	"errors"
	"fmt"
)

var errTruncated = errors.New("mp4: truncated box")

// reader is a bounds-checked sequential reader over a byte slice.
//
// Read errors are sticky: once a read runs off the end, every subsequent read
// returns a zero value and err stays set. This lets parsers read a whole
// structure and check for failure once at the end rather than after every
// field.
type reader struct {
	buf []byte
	pos int
	err error
}

func (r *reader) fail(err error) {
	if r.err == nil {
		r.err = err
	}
}

// take returns the next n bytes, or nil if they are not available.
func (r *reader) take(n int) []byte {
	if r.err != nil {
		return nil
	}
	if n < 0 || r.pos+n > len(r.buf) {
		r.fail(errTruncated)
		return nil
	}
	b := r.buf[r.pos : r.pos+n]
	r.pos += n
	return b
}

func (r *reader) u8() uint8 {
	b := r.take(1)
	if b == nil {
		return 0
	}
	return b[0]
}

func (r *reader) u16() uint16 {
	b := r.take(2)
	if b == nil {
		return 0
	}
	return binary.BigEndian.Uint16(b)
}

func (r *reader) u32() uint32 {
	b := r.take(4)
	if b == nil {
		return 0
	}
	return binary.BigEndian.Uint32(b)
}

func (r *reader) u64() uint64 {
	b := r.take(8)
	if b == nil {
		return 0
	}
	return binary.BigEndian.Uint64(b)
}

func (r *reader) i32() int32 { return int32(r.u32()) }

func (r *reader) skip(n int) { r.take(n) }

func (r *reader) remaining() int {
	if r.err != nil {
		return 0
	}
	return len(r.buf) - r.pos
}

// fullBox reads the version and flags header common to "full" boxes.
func (r *reader) fullBox() (version uint8, flags uint32) {
	v := r.u32()
	return uint8(v >> 24), v & 0x00ffffff
}

// entries reads a full box header and its entry count, and verifies that the
// box actually contains count entries of entrySize bytes. It returns 0 if the
// box is too short, which keeps malformed files from allocating huge slices.
func (r *reader) entries(entrySize int) uint32 {
	r.fullBox()
	count := r.u32()
	if r.err != nil {
		return 0
	}
	if entrySize > 0 && int(count) > r.remaining()/entrySize {
		r.fail(fmt.Errorf("mp4: entry count %d exceeds box size", count))
		return 0
	}
	return count
}

// box is a parsed box header together with its payload.
type box struct {
	typ     string
	payload []byte
}

// errStopWalk unwinds walkBoxes early; it never escapes to the caller.
var errStopWalk = errors.New("stop")

// walkBoxes iterates the sequence of boxes laid out in buf, calling fn for each.
func walkBoxes(buf []byte, fn func(b box) error) error {
	pos := 0
	for pos+8 <= len(buf) {
		size := int64(binary.BigEndian.Uint32(buf[pos:]))
		typ := string(buf[pos+4 : pos+8])
		hdr := int64(8)

		switch size {
		case 0:
			// a size of zero means "extends to the end of the container"
			size = int64(len(buf) - pos)
		case 1:
			// a size of one means the real size is a 64-bit largesize field
			if pos+16 > len(buf) {
				return errTruncated
			}
			size = int64(binary.BigEndian.Uint64(buf[pos+8:]))
			hdr = 16
		}

		if size < hdr || int64(pos)+size > int64(len(buf)) {
			return fmt.Errorf("mp4: box %q at offset %d has invalid size %d", typ, pos, size)
		}

		if err := fn(box{typ: typ, payload: buf[int64(pos)+hdr : int64(pos)+size]}); err != nil {
			if errors.Is(err, errStopWalk) {
				return nil
			}
			return err
		}
		pos += int(size)
	}
	return nil
}

// findBox returns the payload of the first child box of the given type.
func findBox(buf []byte, typ string) ([]byte, bool) {
	var out []byte
	found := false
	_ = walkBoxes(buf, func(b box) error {
		if b.typ == typ {
			out, found = b.payload, true
			return errStopWalk
		}
		return nil
	})
	return out, found
}

// findPath walks a chain of nested box types, returning the innermost payload.
func findPath(buf []byte, path ...string) ([]byte, bool) {
	cur := buf
	for _, typ := range path {
		next, ok := findBox(cur, typ)
		if !ok {
			return nil, false
		}
		cur = next
	}
	return cur, true
}
