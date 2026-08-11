//go:build windows

package amf

// Virtual method table indices, transcribed from the AMF 1.5.2 public headers.
//
// AMF's C++ interfaces use single inheritance with no virtual bases, so each
// derived interface's vtable is its base's vtable followed by its own methods,
// in declaration order. The headers ship a parallel C API whose explicit Vtbl
// structs spell that layout out; these constants follow those structs, and the
// C++ declaration order was cross-checked against them to confirm the two agree.
//
// Because the object layout is the base's followed by the derived part, a
// pointer to a derived interface is also a valid pointer to its base with no
// adjustment. That is why an AMFSurface* returned as AMFData* can be used
// directly, and why AMFBuffer* can be passed where AMFData* is expected.
//
// Getting one of these wrong calls whatever function happens to sit at that
// slot, with mismatched arguments. Do not adjust them without re-reading the
// headers.

// AMFInterface — the root of every AMF interface.
const (
	iAcquire        = 0
	iRelease        = 1
	iQueryInterface = 2
)

// AMFPropertyStorage : AMFInterface — occupies slots 3..12 on every interface
// that derives from it, which is most of them.
const (
	iSetProperty      = 3
	iGetProperty      = 4
	iHasProperty      = 5
	iGetPropertyCount = 6
	iGetPropertyAt    = 7
	iClear            = 8
	iAddTo            = 9
	iCopyTo           = 10
	iAddObserver      = 11
	iRemoveObserver   = 12
)

// AMFContext : AMFPropertyStorage — own methods begin at 13.
//
// The long run of Init/Get/Lock/Unlock quadruples for DX9, DX11, OpenCL, OpenGL,
// XV and Gralloc is why AllocSurface sits as far out as 44: every backend AMF
// has ever supported occupies four slots whether or not it exists on this
// platform.
const (
	iCtxTerminate     = 13
	iCtxInitDX9       = 14
	iCtxGetDX9Device  = 15
	iCtxLockDX9       = 16
	iCtxUnlockDX9     = 17
	iCtxInitDX11      = 18
	iCtxGetDX11Device = 19
	iCtxLockDX11      = 20
	iCtxUnlockDX11    = 21
	iCtxInitOpenCL    = 22
	iCtxAllocBuffer   = 43
	iCtxAllocSurface  = 44
	iCtxGetCompute    = 54
)

// AMFComponent : AMFPropertyStorageEx : AMFPropertyStorage.
//
// PropertyStorageEx contributes four methods at 13..16, so the component's own
// interface only begins at 17.
const (
	iCompGetPropertiesInfoCount = 13
	iCompGetPropertyInfoAt      = 14
	iCompGetPropertyInfo        = 15
	iCompValidateProperty       = 16
	iCompInit                   = 17
	iCompReInit                 = 18
	iCompTerminate              = 19
	iCompDrain                  = 20
	iCompFlush                  = 21
	iCompSubmitInput            = 22
	iCompQueryOutput            = 23
	iCompGetContext             = 24
	iCompSetOutputAllocatorCB   = 25
	iCompGetCaps                = 26
	iCompOptimize               = 27
)

// AMFData : AMFPropertyStorage — own methods begin at 13.
const (
	iDataGetMemoryType = 13
	iDataDuplicate     = 14
	iDataConvert       = 15
	iDataInterop       = 16
	iDataGetDataType   = 17
	iDataIsReusable    = 18
	iDataSetPts        = 19
	iDataGetPts        = 20
	iDataSetDuration   = 21
	iDataGetDuration   = 22
)

// AMFSurface : AMFData — own methods begin at 23.
const (
	iSurfGetFormat      = 23
	iSurfGetPlanesCount = 24
	iSurfGetPlaneAt     = 25
	iSurfGetPlane       = 26
	iSurfGetFrameType   = 27
	iSurfSetFrameType   = 28
	iSurfSetCrop        = 29
)

// AMFBuffer : AMFData — own methods begin at 23.
const (
	iBufSetSize   = 23
	iBufGetSize   = 24
	iBufGetNative = 25
)

// AMFPlane : AMFInterface — own methods begin at 3.
const (
	iPlaneGetType      = 3
	iPlaneGetNative    = 4
	iPlaneGetPixelSize = 5
	iPlaneGetOffsetX   = 6
	iPlaneGetOffsetY   = 7
	iPlaneGetWidth     = 8
	iPlaneGetHeight    = 9
	iPlaneGetHPitch    = 10
	iPlaneGetVPitch    = 11
	iPlaneIsTiled      = 12
)

// AMFFactory — a standalone interface, not derived from AMFInterface, so its
// own methods start at 0 and it has no Acquire/Release.
const (
	iFacCreateContext   = 0
	iFacCreateComponent = 1
	iFacSetCacheFolder  = 2
	iFacGetCacheFolder  = 3
	iFacGetDebug        = 4
	iFacGetTrace        = 5
	iFacGetPrograms     = 6
)

// AMF_RESULT values.
type result uintptr

const (
	resOK                result = 0
	resFail              result = 1
	resNotSupported      result = 10
	resNotInitialized    result = 13
	resInvalidFormat     result = 14
	resWrongState        result = 15
	resNoDevice          result = 17
	resDirectXFailed     result = 18
	resEOF               result = 23
	resRepeat            result = 24
	resInputFull         result = 25
	resResolutionChanged result = 26
	resResolutionUpdated result = 27
	resCodecNotSupported result = 30
	resDecoderNotPresent result = 33
	resNoFreeSurfaces    result = 35
	resNeedMoreInput     result = 44
)

var resultNames = map[result]string{
	0: "AMF_OK", 1: "AMF_FAIL", 2: "AMF_UNEXPECTED", 3: "AMF_ACCESS_DENIED",
	4: "AMF_INVALID_ARG", 5: "AMF_OUT_OF_RANGE", 6: "AMF_OUT_OF_MEMORY",
	7: "AMF_INVALID_POINTER", 8: "AMF_NO_INTERFACE", 9: "AMF_NOT_IMPLEMENTED",
	10: "AMF_NOT_SUPPORTED", 11: "AMF_NOT_FOUND", 12: "AMF_ALREADY_INITIALIZED",
	13: "AMF_NOT_INITIALIZED", 14: "AMF_INVALID_FORMAT", 15: "AMF_WRONG_STATE",
	16: "AMF_FILE_NOT_OPEN", 17: "AMF_NO_DEVICE", 18: "AMF_DIRECTX_FAILED",
	19: "AMF_OPENCL_FAILED", 20: "AMF_GLX_FAILED", 21: "AMF_XV_FAILED",
	22: "AMF_ALSA_FAILED", 23: "AMF_EOF", 24: "AMF_REPEAT", 25: "AMF_INPUT_FULL",
	26: "AMF_RESOLUTION_CHANGED", 27: "AMF_RESOLUTION_UPDATED",
	28: "AMF_INVALID_DATA_TYPE", 29: "AMF_INVALID_RESOLUTION",
	30: "AMF_CODEC_NOT_SUPPORTED", 31: "AMF_SURFACE_FORMAT_NOT_SUPPORTED",
	32: "AMF_SURFACE_MUST_BE_SHARED", 33: "AMF_DECODER_NOT_PRESENT",
	34: "AMF_DECODER_SURFACE_ALLOCATION_FAILED", 35: "AMF_DECODER_NO_FREE_SURFACES",
	36: "AMF_ENCODER_NOT_PRESENT", 44: "AMF_NEED_MORE_INPUT", 45: "AMF_VULKAN_FAILED",
}

// AMF_MEMORY_TYPE
const (
	memHost = 1
	memDX11 = 3
)

// AMF_SURFACE_FORMAT
const (
	surfaceNV12 = 1
	surfaceBGRA = 3
	surfaceRGBA = 5
)

// AMF_DATA_TYPE
const (
	dataTypeBuffer  = 0
	dataTypeSurface = 1
)

// AMF_DX_VERSION
const (
	dx11_0 = 110
	dx11_1 = 111
)

// AMF_VARIANT_TYPE
const (
	variantBool      = 1
	variantInt64     = 2
	variantSize      = 5
	variantRate      = 7
	variantInterface = 12
)

// AMF_VIDEO_DECODER_MODE_ENUM
const (
	decodeModeRegular    = 0
	decodeModeCompliant  = 1
	decodeModeLowLatency = 2
)

// AMF_VIDEO_CONVERTER_SCALE_ENUM
const (
	scaleBilinear = 0
	scaleBicubic  = 1
)

// Component identifiers and property names.
const (
	componentVideoConverter = "AMFVideoConverter"
	componentEncoderAVC     = "AMFVideoEncoderVCE_AVC"

	propDecoderExtraData   = "ExtraData"
	propDecoderReorderMode = "ReorderMode"
	propDecoderLowLatency  = "LowLatencyDecode"

	propConverterOutputFormat = "OutputFormat"
	propConverterMemoryType   = "MemoryType"
	propConverterOutputSize   = "OutputSize"
	propConverterScale        = "ScaleType"
	propConverterKeepAspect   = "KeepAspectRatio"
)

// AVC encoder property names, from VideoEncoderVCE.h.
//
// Usage is special: setting it applies a whole preset of defaults for the named
// scenario, overwriting properties already set. It therefore has to be set
// first, before anything meant to survive.
const (
	propEncUsage         = "Usage"
	propEncProfile       = "Profile"
	propEncProfileLevel  = "ProfileLevel"
	propEncQualityPreset = "QualityPreset"
	propEncFrameSize     = "FrameSize"
	propEncFrameRate     = "FrameRate"
	propEncRateControl   = "RateControlMethod"
	propEncQPI           = "QPI"
	propEncQPP           = "QPP"
	propEncIDRPeriod     = "IDRPeriod"
	propEncBPicPattern   = "BPicturesPattern"
	propEncExtraData     = "ExtraData"
	propEncOutputType    = "OutputDataType"
)

// AMF_VIDEO_ENCODER_USAGE_ENUM
const (
	encUsageTranscoding = 0
)

// AMF_VIDEO_ENCODER_PROFILE_ENUM — the values are the H.264 profile_idc numbers
// the standard itself assigns, which is why they are not a dense range.
const (
	encProfileMain = 77
	encProfileHigh = 100
)

// AMF_VIDEO_ENCODER_QUALITY_PRESET_ENUM
const (
	encPresetBalanced = 0
	encPresetSpeed    = 1
	encPresetQuality  = 2
)

// AMF_VIDEO_ENCODER_RATE_CONTROL_METHOD_ENUM
const (
	encRateControlConstantQP = 0
)

// AMF_VIDEO_ENCODER_OUTPUT_DATA_TYPE_ENUM
const (
	encOutputIDR = 0
	encOutputI   = 1
)

// amfFullVersion is the API version this binding was written against,
// AMF_MAKE_FULL_VERSION(1, 5, 2, 0).
const amfFullVersion uint64 = (1 << 48) | (5 << 32) | (2 << 16)

// amfMinVersion is the oldest runtime whose vtable layouts match the ones above.
// AMF has only ever appended methods to these interfaces, adding new
// functionality on new interfaces (AMFContext1, AMFSurface1) rather than
// reordering existing ones, so the layouts hold across 1.4.x and 1.5.x.
const amfMinVersion uint64 = (1 << 48) | (4 << 32)
