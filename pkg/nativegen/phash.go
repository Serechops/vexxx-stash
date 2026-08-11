package nativegen

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/stashapp/stash/pkg/nativegen/amf"
	"github.com/stashapp/stash/pkg/nativegen/container"
	"github.com/stashapp/stash/pkg/nativegen/container/mp4"
)

// PhashFrames decodes the frames a perceptual hash is computed from, already
// scaled to the target width.
//
// # Which frame, and what it costs
//
// The exact frame at each target time, which is the one ffmpeg's accurate seek
// returns and therefore the one upstream stash and stash-box hashed. That means
// decoding every frame from each target's preceding keyframe, because that is
// what inter-prediction means, and only the target is ever brought back across
// PCIe -- SetWanted drops the rest before they are converted or copied.
//
// The cost of that is a property of the file rather than of this code, and it is
// worth measuring before assuming it is prohibitive. Twenty-five targets on an
// 8000x4000 HEVC file with one-second GOPs is 780 frame decodes, not the nine
// thousand a six-second GOP would need. Keyframe snapping was tried instead and
// abandoned: it is far quicker, and both backends can be made to agree on it
// exactly, but it lands 6 to 18 bits from the value stash-box holds -- and it is
// least accurate on exactly the long-GOP files that make it most tempting, since
// the error grows with the distance from keyframe to target.
//
// The number that decides whether this is fast is the container's sync table, not
// the resolution and not the bitrate: the walk is twenty-five runs of half a GOP.
// Read it from the track rather than from ffprobe's key_frame flag, which counts
// pictures the bitstream marks as intra and can report a keyframe interval
// several times shorter than the one either backend can actually seek to.
//
// # Why the walk is split across decoders
//
// Because ffmpeg is not the slow thing it looks like. Its software decode is
// bitrate-bound and threaded across every core, while one decode engine is
// pixel-bound and serial, so the two swap places as bitrate falls: on a 123 Mbps
// 8000x4000 file ffmpeg needs 22 ms/frame against this path's 14.6, and on a
// 41 Mbps 7680x3840 file it needs 9.2 against this path's 11.7. At one decoder
// the second of those files was a regression -- the correct hash, 10 seconds
// slower than the path it replaced.
//
// Splitting the targets across both of the hardware's decode engines is what
// makes the win hold at either end, because it is the axis ffmpeg has already
// spent and this path had not. Measured after doing so: 26.3s against ffmpeg's
// 40.2s on the file above, 6.0s against 16.9s on the 8K one, 559ms against 1.7s
// on a 768x432 file. See phashDecoders for the split and devices.go for what
// makes it land on two engines rather than one.
//
// # What pixels this returns
//
// The frames are decoded at coded resolution with the GPU converter switched
// off, then piped through a single ffmpeg process so that swscale does the
// scaling. AMF's converter and swscale filter a heavy reduction differently --
// RMSE 15 to 26 at 160px, enough to move the hash -- so the GPU never touches
// the reduction. The frames go through the pipe as consecutive rawvideo frames
// rather than stacked into one tall image, which matters twice over: swscale's
// vertical taps no longer reach across the joins between frames, and there is no
// resolution above which a stacked buffer stops fitting.
//
// Verified bit-for-bit against the per-frame ffmpeg path on an untagged 768x432
// H.264 file and a bt709-tagged 8000x4000 HEVC file: max channel difference 0.
//
// VR footage is hashed as it is stored, without reprojection. Every ffmpeg path
// in this package hashes the raw stored frame, upstream stash and stash-box do
// too, and a reprojected hash would match none of them; reprojection also makes
// the hash depend on a scene field a user can edit. It buys a fingerprint
// nothing -- equirect frames discriminate scenes just as well.
//
// An error means the native path declined; callers should fall back to ffmpeg.
// Errors wrap container.ErrUnsupported or amf.ErrUnavailable.
func PhashFrames(ctx context.Context, opts PhashFrameOptions, ffmpegPath string) ([]image.Image, error) {
	if len(opts.Times) == 0 {
		return nil, fmt.Errorf("%w: no times requested", container.ErrUnsupported)
	}
	if opts.Width <= 0 {
		return nil, fmt.Errorf("%w: invalid frame width %d", container.ErrUnsupported, opts.Width)
	}
	if ffmpegPath == "" {
		return nil, fmt.Errorf("%w: no ffmpeg path provided", container.ErrUnsupported)
	}

	f, err := mp4.Open(opts.Path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	track := f.Video()
	if track == nil {
		return nil, container.ErrNoVideoTrack
	}
	if track.Rotation != 0 {
		return nil, fmt.Errorf("%w: track carries a display matrix (rotation %d)",
			container.ErrUnsupported, track.Rotation)
	}

	if len(track.SyncSamples()) == 0 {
		return nil, fmt.Errorf("%w: track has no keyframes to decode from", container.ErrUnsupported)
	}

	wanted, err := samplesAt(track, opts.Times)
	if err != nil {
		return nil, err
	}

	// Distinct kept devices are what make the split reliably land on both engines
	// rather than half the time. Not getting them is not a reason to give the
	// split up: see deviceSet.acquire.
	parts := partitionWanted(track, wanted)
	devs, release := decodeDevices.acquire(len(parts))
	if release != nil {
		defer release()
	}

	if len(parts) == 1 {
		dec, err := decoderOn(devs, 0, phashDecoderConfig(track))
		if err != nil {
			return nil, err
		}
		defer dec.Close()

		return decodeAndScale(ctx, f, dec, wanted, track.Width, track.Height, opts, ffmpegPath)
	}

	return decodeAndScaleParallel(ctx, f, track, parts, len(wanted), opts, ffmpegPath, devs)
}

// phashDecoders is how many decoders the walk is spread across.
//
// Two, because that is how many independent decode engines the hardware this was
// built on has, and the gain comes from the engines rather than from the
// scheduling: the same decode run on two decoders at once completes 1.92x as many
// frames per second as on one, measured in stages_real_test.go. Asking for more
// than the hardware has does not queue them usefully — it adds decoders
// contending for one engine, each with its own driver context and reorder buffer.
//
// Should this ever need to follow the hardware rather than state it, the number
// to ask for is the engine count, not the core count: these are fixed-function
// blocks and there are two of them whatever the rest of the GPU looks like.
//
// Splitting the work is only half of it. Which engine each decoder lands on is
// the driver's choice, and getting one per engine rather than two on the same one
// depends on the decoders sitting on distinct devices that have been kept: see
// devices.go, which is where that reliability comes from.
const phashDecoders = 2

// phashParallelMinFrames is the decode budget below which the walk stays on one
// decoder.
//
// Splitting costs a decoder, a driver context, a file handle and an ffmpeg
// process. Below a few hundred frames the whole decode is already well inside a
// second, so that setup would be most of the runtime: the split would show up as
// a regression on small files in exchange for saving milliseconds on them.
const phashParallelMinFrames = 256

// newPhashDecoder opens a decoder for phash frames: coded size with the GPU
// converter switched off, so frames come back as raw NV12 at full resolution and
// nothing has been scaled before swscale sees it.
func newPhashDecoder(track *container.VideoTrack) (*amf.Decoder, error) {
	return amf.NewDecoder(phashDecoderConfig(track))
}

// phashDecoderConfig is the decoder configuration the phash walk needs, kept
// separate from newPhashDecoder so that a caller placing the decoder on its own
// device asks for the same thing rather than restating it.
func phashDecoderConfig(track *container.VideoTrack) amf.Config {
	return amf.Config{
		Codec:     track.Codec,
		Width:     track.Width,
		Height:    track.Height,
		ExtraData: track.ParameterSets,
		// Whole runs of consecutive frames are submitted here, so the decoder
		// needs its reorder window to hand back frames in presentation order.
		LowLatency:    false,
		SkipConverter: true,
	}
}

// estimateBudget approximates how many samples the walk will decode: for every
// target, the run from the keyframe that precedes it.
//
// This is an estimate and not a count. Targets sharing a GOP are walked once,
// which this over-counts, and the reorder pushes add samples it does not know
// about, so the true figure lands either side of it. It decides only whether a
// file is large enough to be worth splitting, which does not need better.
func estimateBudget(track *container.VideoTrack, wanted []wantedFrame) int {
	total := 0
	for _, wf := range wanted {
		total += wf.sample - syncBefore(track, wf.sample) + 1
	}
	return total
}

// partitionWanted splits the walk into one contiguous group per decoder,
// returning a single group when splitting would not pay for itself.
//
// The groups are contiguous in sample order, which is what keeps them as cheap as
// the unsplit walk: each is still one forward pass through its own stretch of the
// file, so the continuation that lets two targets inside one GOP decode it once
// survives everywhere but the joins. Dealing the targets out round-robin instead
// would leave every decoder walking the whole file.
func partitionWanted(track *container.VideoTrack, wanted []wantedFrame) [][]wantedFrame {
	return partitionWantedN(track, wanted, phashDecoders)
}

// partitionWantedN is partitionWanted for an explicit number of groups, so that
// the number can be swept against a real file rather than assumed.
func partitionWantedN(track *container.VideoTrack, wanted []wantedFrame, n int) [][]wantedFrame {
	if n < 2 || len(wanted) < 2*n {
		return [][]wantedFrame{wanted}
	}
	if estimateBudget(track, wanted) < phashParallelMinFrames {
		return [][]wantedFrame{wanted}
	}

	parts := make([][]wantedFrame, 0, n)
	start := 0
	for i := 0; i < n && start < len(wanted); i++ {
		end := len(wanted)
		if i < n-1 {
			end = (i + 1) * len(wanted) / n
			// One sample can fill several slots, when two target times land inside
			// one frame's interval or several past the end clamp to the last frame.
			// Cutting through such a run would have both decoders walk to the same
			// frame, so the boundary moves past the whole of it.
			for end < len(wanted) && wanted[end].sample == wanted[end-1].sample {
				end++
			}
			if end <= start {
				continue
			}
		}
		parts = append(parts, wanted[start:end])
		start = end
	}
	return parts
}

// decodeAndScaleParallel runs one decoder per group and reassembles the frames
// into the order they were asked for.
//
// Each group gets its own decoder, its own file handle and its own ffmpeg
// process. The separate handles are not defensive: SampleAnnexB seeks and then
// reads, so two walks sharing one handle would each move the other's offset. The
// separate ffmpeg processes are what make ordering a non-problem — a group's
// frames go down its own pipe in its own order, so no decoder ever has to wait
// for another's frames to keep one shared stream in slot order, which is the
// deadlock this shape avoids rather than solves. Holding the results costs
// nothing: a scaled tile is 51 KB where a coded frame is 38 MB.
//
// None of this changes a pixel. Every frame is still one rawvideo picture scaled
// on its own by swscale under the same arguments, which is what the
// bit-exactness rests on; the only difference is which process does it.
//
// devs, when given, holds one kept device per group, which is what pins each
// group's decoder to its own video engine. A nil devs still splits, on contexts
// created per decoder, which is faster about half the time and no slower the rest.
func decodeAndScaleParallel(ctx context.Context, f *mp4.File, track *container.VideoTrack, parts [][]wantedFrame, total int, opts PhashFrameOptions, ffmpegPath string, devs []*amf.Device) ([]image.Image, error) {
	results := make([][]image.Image, len(parts))

	g, gctx := errgroup.WithContext(ctx)
	for i, part := range parts {
		g.Go(func() error {
			// The first group reuses the handle that is already open; the rest get
			// their own for the duration of the group.
			handle := f
			if i > 0 {
				h, err := mp4.Open(opts.Path)
				if err != nil {
					return err
				}
				defer h.Close()
				handle = h
			}

			dec, err := decoderOn(devs, i, phashDecoderConfig(handle.Video()))
			if err != nil {
				return err
			}
			defer dec.Close()

			imgs, err := decodeAndScale(gctx, handle, dec, localSlots(part),
				track.Width, track.Height, opts, ffmpegPath)
			if err != nil {
				return err
			}
			results[i] = imgs
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}

	frames := make([]image.Image, total)
	for i, part := range parts {
		got := results[i]
		if len(got) != len(part) {
			return nil, fmt.Errorf("%w: decoder %d returned %d frames for %d slots",
				container.ErrUnsupported, i, len(got), len(part))
		}
		for j, wf := range part {
			frames[wf.slot] = got[j]
		}
	}
	for slot, img := range frames {
		if img == nil {
			return nil, fmt.Errorf("%w: no frame decoded for slot %d",
				container.ErrUnsupported, slot)
		}
	}

	return frames, nil
}

// localSlots renumbers a group's slots from zero, so each decoder writes to its
// own ffmpeg in a dense order of its own.
//
// The entries keep the sample they resolved to, and the caller keeps the original
// group, so the global slot each frame belongs to is still recoverable from the
// unrenumbered group — that pairing is what puts the montage back in request
// order.
func localSlots(part []wantedFrame) []wantedFrame {
	local := make([]wantedFrame, len(part))
	for j, wf := range part {
		local[j] = wantedFrame{sample: wf.sample, slot: j}
	}
	return local
}

// PhashFrameOptions describes the frames to decode for a perceptual hash.
type PhashFrameOptions struct {
	Path  string
	Times []float64
	Width int

	// Colorspace and ColorRange are the source's colour tags in ffmpeg's own
	// naming ("bt709", "smpte170m", "tv", "pc"), and they are not cosmetic. The
	// frames reach ffmpeg as rawvideo, which carries no tags of its own, so
	// whatever is declared here is what swscale uses to convert them; the path
	// this has to agree with gets the tags from the file. Leave them empty for
	// footage that declares none, which is the common case and which swscale
	// then handles with its default matrix.
	//
	// Getting this wrong is not loud. Declaring nothing for a file tagged bt709
	// produced frames a mean of 0.9/255 away from the reference on an 8K file --
	// visually identical, and enough to move the hash.
	Colorspace string
	ColorRange string
}

// decodeAndScale decodes each wanted sample and streams it through one ffmpeg
// process for scaling, returning the scaled frames in request order.
//
// The frames are written to ffmpeg as they are decoded rather than collected
// first, so peak memory is one coded frame — 38 MB at 8K — instead of one per
// requested time.
func decodeAndScale(ctx context.Context, f *mp4.File, dec *amf.Decoder, wanted []wantedFrame, w, h int, opts PhashFrameOptions, ffmpegPath string) ([]image.Image, error) {
	nf := len(wanted)
	outW := opts.Width

	// The rawvideo demuxer frames the stream by size, so consecutive frames of
	// w*h*3/2 bytes arrive as consecutive pictures and each is scaled on its own.
	//
	// The source's colour tags are declared on the input, or omitted when the
	// source declares none, so that swscale converts these frames exactly as it
	// converts the file itself on the path this has to agree with. Both halves of
	// that were measured: hardcoding bt709 moved an untagged 768x432 file by 10
	// bits, and omitting the tags moved a bt709-tagged 8K file by a mean of
	// 0.9/255. Neither is visible; both change the hash.
	args := []string{
		"-loglevel", "error",
		"-f", "rawvideo",
		"-pix_fmt", "yuv420p",
		"-s", fmt.Sprintf("%dx%d", w, h),
	}
	if opts.Colorspace != "" {
		args = append(args, "-colorspace", opts.Colorspace)
	}
	if opts.ColorRange != "" {
		args = append(args, "-color_range", opts.ColorRange)
	}
	args = append(args,
		"-i", "-",
		"-vf", fmt.Sprintf("scale=%d:-2", outW),
		"-frames:v", strconv.Itoa(nf),
		"-f", "rawvideo",
		"-pix_fmt", "bgra",
		"-",
	)

	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("%w: ffmpeg stdin pipe: %v", container.ErrUnsupported, err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("%w: ffmpeg stdout pipe: %v", container.ErrUnsupported, err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("%w: starting ffmpeg: %v", container.ErrUnsupported, err)
	}

	// Read the output concurrently with writing the input. The scaled frames are
	// small, but not small enough to sit in a pipe buffer while nine hundred
	// megabytes go the other way.
	type readResult struct {
		data []byte
		err  error
	}
	done := make(chan readResult, 1)
	go func() {
		data, err := io.ReadAll(stdout)
		done <- readResult{data, err}
	}()

	writeErr := feedExactFrames(ctx, f, dec, wanted, w, h, stdin)
	closeErr := stdin.Close()

	res := <-done
	waitErr := cmd.Wait()

	// A decode or write failure is the useful error; ffmpeg's own complaint about
	// truncated input is a consequence of it.
	switch {
	case writeErr != nil:
		return nil, writeErr
	case res.err != nil:
		return nil, fmt.Errorf("%w: reading ffmpeg output: %v", container.ErrUnsupported, res.err)
	case closeErr != nil:
		return nil, fmt.Errorf("%w: closing ffmpeg stdin: %v", container.ErrUnsupported, closeErr)
	case waitErr != nil:
		return nil, fmt.Errorf("%w: ffmpeg: %v (%s)", container.ErrUnsupported, waitErr,
			strings.TrimSpace(stderr.String()))
	}

	return sliceScaled(res.data, nf, outW)
}

// feedExactFrames decodes the exact wanted frames and writes each one to the
// sink as planar yuv420p, in slot order.
//
// The decoder is walked forward from the keyframe before each target, which is
// the only way to reach a frame that is not itself a keyframe. Three things keep
// that from costing more than it has to:
//
//   - SetWanted names only the targets, so the frames decoded purely to
//     reconstruct them are released before the converter or the PCIe copy sees
//     them. On a 780-frame walk that is 755 frames of readback not done.
//   - A run continues from where the last one stopped whenever the next target's
//     keyframe is already behind the cursor, so two targets sharing a GOP decode
//     it once.
//   - Frames are written to ffmpeg as they arrive rather than collected, so peak
//     memory is a couple of coded frames instead of twenty-five.
//
// Frames arrive in presentation order, which for ascending target times is also
// slot order, but early arrivals are held rather than trusted: writing one out of
// order would silently transpose two tiles of the montage.
func feedExactFrames(ctx context.Context, f *mp4.File, dec *amf.Decoder, wanted []wantedFrame, w, h int, sink io.Writer) error {
	track := f.Video()

	// One sample can fill more than one slot, when two target times land inside
	// one frame's interval or several past the end clamp to the last frame. This
	// has to be a slice per sample: a plain sample-to-slot map silently drops the
	// duplicate and the decode ends one frame short.
	slots := make(map[int][]int, len(wanted))
	for _, wf := range wanted {
		slots[wf.sample] = append(slots[wf.sample], wf.slot)
	}

	dec.SetWanted(func(pts int64) bool {
		_, ok := slots[int(pts)]
		return ok
	})

	total := len(wanted)
	planar := make([]byte, w*h*3/2)
	pending := make(map[int][]byte, 4)
	next := 0

	// flush writes every frame that is now contiguous from next.
	flush := func() error {
		for {
			nv, ok := pending[next]
			if !ok {
				return nil
			}
			delete(pending, next)
			nv12ToPlanar(nv, planar, w, h)
			if _, err := sink.Write(planar); err != nil {
				return fmt.Errorf("%w: writing frame %d to ffmpeg: %v",
					container.ErrUnsupported, next, err)
			}
			next++
		}
	}

	// produced reports whether a slot's frame has been written or is in hand.
	produced := func(slot int) bool {
		if slot < next {
			return true
		}
		_, ok := pending[slot]
		return ok
	}

	p := &nv12Pump{ctx: ctx, dec: dec, place: func(nv *amf.FrameNV12) error {
		for _, slot := range slots[int(nv.PTS)] {
			if slot < next || produced(slot) {
				continue
			}
			pending[slot] = nv.Data
		}
		return flush()
	}}

	step := func(i int) error {
		data, err := f.SampleAnnexB(i)
		if err != nil {
			return err
		}
		if err := p.submit(data, int64(i)); err != nil {
			return fmt.Errorf("nativegen: sample %d: %w", i, err)
		}
		return nil
	}

	// high is the last sample handed to the decoder. Resuming from it rather than
	// from the previous target keeps the reorder pushes below from being submitted
	// a second time by the next target's run, which would decode them twice.
	high := -1
	for _, wf := range wanted {
		start := syncBefore(track, wf.sample)
		if high+1 > start {
			// Already decoded past this keyframe, so the decoder holds valid
			// reference state and the run can continue instead of restarting.
			start = high + 1
		}
		for i := start; i <= wf.sample; i++ {
			if err := step(i); err != nil {
				return err
			}
			high = i
		}

		// A frame held for reordering only comes out once enough of what follows
		// it has been submitted, so push past it until it appears.
		for pushed := 0; !produced(wf.slot) && pushed < maxReorderPush; pushed++ {
			nextSample := high + 1
			if nextSample >= len(track.Samples) {
				break
			}
			if err := step(nextSample); err != nil {
				return err
			}
			high = nextSample
		}
	}

	if next < total {
		if err := p.finish(); err != nil {
			return err
		}
		if err := flush(); err != nil {
			return err
		}
	}

	if next != total {
		return fmt.Errorf("nativegen: decoded %d of %d phash frames", next, total)
	}
	return nil
}

// nv12ToPlanar rewrites one NV12 frame as planar yuv420p in dst, de-interleaving
// the chroma plane into separate U and V planes.
func nv12ToPlanar(nv12, dst []byte, w, h int) {
	lumaSize := w * h
	copy(dst[:lumaSize], nv12[:lumaSize])

	chromaPairs := (w / 2) * (h / 2)
	uv := nv12[lumaSize:]
	u := dst[lumaSize : lumaSize+chromaPairs]
	v := dst[lumaSize+chromaPairs:]
	for i := 0; i < chromaPairs; i++ {
		u[i] = uv[i*2]
		v[i] = uv[i*2+1]
	}
}

// sliceScaled cuts ffmpeg's bgra output into nf frames of the given width,
// converting each to an RGBA image.
//
// The height is taken from the byte count rather than recomputed from the source
// aspect: scale's -2 rounds to the nearest even value and reproducing that
// arithmetic exactly is a needless way to be wrong by two rows.
func sliceScaled(data []byte, nf, outW int) ([]image.Image, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("%w: ffmpeg produced no output", container.ErrUnsupported)
	}

	frameBytes := len(data) / nf
	stride := outW * 4
	if frameBytes == 0 || frameBytes%stride != 0 || frameBytes*nf != len(data) {
		return nil, fmt.Errorf("%w: ffmpeg produced %d bytes, not %d frames of %dpx-wide bgra",
			container.ErrUnsupported, len(data), nf, outW)
	}
	outH := frameBytes / stride

	frames := make([]image.Image, nf)
	for i := range frames {
		off := i * frameBytes
		img := image.NewRGBA(image.Rect(0, 0, outW, outH))
		for y := 0; y < outH; y++ {
			row := data[off+y*stride : off+(y+1)*stride]
			dst := img.Pix[y*img.Stride : y*img.Stride+stride]
			for x := 0; x < stride; x += 4 {
				dst[x+0] = row[x+2]
				dst[x+1] = row[x+1]
				dst[x+2] = row[x+0]
				dst[x+3] = row[x+3]
			}
		}
		frames[i] = img
	}

	return frames, nil
}

// nv12Pump drives the decoder's submit/receive protocol for raw NV12 readback,
// mirroring pump but using ReceiveNV12.
type nv12Pump struct {
	ctx   context.Context
	dec   *amf.Decoder
	place func(*amf.FrameNV12) error
}

// drain takes whatever output is ready without waiting for more, and reports
// how many frames it placed.
func (p *nv12Pump) drain() (int, error) {
	placed := 0
	for {
		fr, err := p.dec.ReceiveNV12()
		switch {
		case err == amf.ErrNeedMoreInput, err == amf.ErrDrained:
			return placed, nil
		case err != nil:
			return placed, err
		}
		if err := p.place(fr); err != nil {
			return placed, err
		}
		placed++
	}
}

// submit hands one compressed frame to the decoder, then collects whatever that
// made ready.
func (p *nv12Pump) submit(data []byte, pts int64) error {
	if err := p.ctx.Err(); err != nil {
		return err
	}

	for attempt := 0; ; attempt++ {
		err := p.dec.Submit(data, pts)
		if err == nil {
			if _, err := p.drain(); err != nil {
				return fmt.Errorf("reading output: %w", err)
			}
			return nil
		}
		if err != amf.ErrInputFull {
			return err
		}
		if attempt >= maxSubmitRetries {
			return fmt.Errorf("decoder input stayed full")
		}
		placed, err := p.drain()
		if err != nil {
			return err
		}
		if placed == 0 {
			time.Sleep(submitBackoff)
		}
	}
}

// finish drains the decoder until it reports end of stream.
func (p *nv12Pump) finish() error {
	if err := p.dec.Drain(); err != nil {
		return err
	}
	for i := 0; i < maxDrainPolls; i++ {
		placed, err := p.drain()
		if err != nil {
			return err
		}
		if placed == 0 {
			// If the decoder reports ErrDrained, drain() returns 0 with no
			// error, which means we're done.
			_, err := p.dec.ReceiveNV12()
			if err == amf.ErrDrained {
				return nil
			}
			if err != amf.ErrNeedMoreInput && err != nil {
				return err
			}
			time.Sleep(submitBackoff)
		}
	}
	return nil
}

// PhashAvailable reports whether the native phash path can be used.
func PhashAvailable(ffmpegPath string) bool {
	return ffmpegPath != "" && amf.Available()
}

// PhashTimes computes 25 evenly-spaced timestamps for a phash, reproducing
// the same arithmetic the per-frame path uses.
func PhashTimes(duration float64) []float64 {
	const n = 25
	times := make([]float64, n)
	step := duration * 0.9 / n
	offset := duration * 0.05
	for i := range times {
		times[i] = offset + float64(i)*step
	}
	return times
}

// PhashFramesFromPath is a convenience wrapper that probes the duration,
// computes the 25 phash timestamps, and decodes them.
func PhashFramesFromPath(ctx context.Context, path string, width int, ffmpegPath, ffprobePath string) ([]image.Image, error) {
	duration, err := probeDuration(path, ffprobePath)
	if err != nil {
		return nil, err
	}
	times := PhashTimes(duration)
	return PhashFrames(ctx, PhashFrameOptions{Path: path, Times: times, Width: width}, ffmpegPath)
}

// probeDuration gets the duration of a media file using ffprobe.
func probeDuration(path, ffprobePath string) (float64, error) {
	cmd := exec.Command(ffprobePath,
		"-loglevel", "error",
		"-show_entries", "format=duration",
		"-of", "csv=p=0",
		path,
	)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("%w: probing duration: %v", container.ErrUnsupported, err)
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil {
		return 0, fmt.Errorf("%w: parsing duration %q: %v", container.ErrUnsupported, strings.TrimSpace(string(out)), err)
	}
	return duration, nil
}
