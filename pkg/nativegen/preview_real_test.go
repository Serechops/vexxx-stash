package nativegen

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The shape of a real preview, matching what pkg/scene/generate asks ffmpeg for.
const (
	testPreviewSegments = 12
	testPreviewDuration = 0.75
	testPreviewWidth    = 640
	testPreviewQP       = 22
)

// TestPreviewRealFile builds a preview from a real file and hands it to ffprobe.
//
// Everything upstream of this has been checked in isolation — the demuxer
// against ffprobe, the encoder against ffmpeg, the muxer against our own
// demuxer. This is the one test that says the whole thing produces a file a
// player will accept.
//
// Opt in with:
//
//	STASH_NATIVEGEN_TEST_MP4=<path> go test ./pkg/nativegen/ -run PreviewRealFile -v
//
// Set STASH_NATIVEGEN_TEST_OUT to keep the preview somewhere you can watch it,
// and STASH_NATIVEGEN_TEST_VRMODE to exercise the reprojection.
func TestPreviewRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to run")
	}
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}
	probe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is not on PATH")
	}
	t.Logf("backend: %s", Describe())

	vrMode := os.Getenv("STASH_NATIVEGEN_TEST_VRMODE")
	name := "native_preview.mp4"
	if vrMode != "" {
		name = "native_preview_" + vrMode + ".mp4"
		t.Logf("projection: %s", vrMode)
	}

	// Segments spread across the first few minutes, the way the generator
	// spreads them across a whole film.
	starts := make([]float64, testPreviewSegments)
	for i := range starts {
		starts[i] = 20 + float64(i)*15
	}

	var buf bytes.Buffer
	start := time.Now()
	err = Preview(context.Background(), PreviewOptions{
		Path:            path,
		Starts:          starts,
		SegmentDuration: testPreviewDuration,
		Width:           testPreviewWidth,
		VRMode:          vrMode,
		QP:              testPreviewQP,
		// As the generator asks for a scene preview. The segments move onto
		// keyframes, which is where most of this path's speed comes from, and
		// the checks below still have to hold afterwards: the same number of
		// frames, over the same total length.
		SnapToKeyframes: true,
	}, &buf)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Preview: %v", err)
	}

	wantDuration := testPreviewSegments * testPreviewDuration
	t.Logf("%s: %.1fs preview in %v (%d KB)", filepath.Base(path),
		wantDuration, elapsed.Round(time.Millisecond), buf.Len()/1024)

	out := os.Getenv("STASH_NATIVEGEN_TEST_OUT")
	if out == "" {
		out = t.TempDir()
	}
	preview := filepath.Join(out, name)
	if err := os.WriteFile(preview, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("writing preview: %v", err)
	}
	t.Logf("wrote %s", preview)

	info, err := exec.Command(probe, "-v", "error",
		"-select_streams", "v:0",
		"-count_frames",
		"-show_entries", "stream=codec_name,width,height,nb_read_frames,r_frame_rate,duration",
		"-of", "default=noprint_wrappers=1", preview).Output()
	if err != nil {
		t.Fatalf("ffprobe rejected the preview: %v", err)
	}
	fields := parseProbe(string(info))
	t.Logf("ffprobe: %v", fields)

	if fields["codec_name"] != "h264" {
		t.Errorf("codec is %q, want h264", fields["codec_name"])
	}
	if fields["width"] != strconv.Itoa(testPreviewWidth) {
		t.Errorf("preview is %s wide, want %d", fields["width"], testPreviewWidth)
	}
	// VR footage is flattened to a fixed 16:9 view whatever the source's shape,
	// which is the ffmpeg path's behaviour too.
	if vrMode != "" && fields["height"] != "360" {
		t.Errorf("VR preview is %s high, want 360", fields["height"])
	}

	// The duration has to come out close to the segments that went in. A
	// mismatch means frames were dropped, or the timescale arithmetic is wrong,
	// and either shows up here as a preview that runs at the wrong speed.
	duration, err := strconv.ParseFloat(fields["duration"], 64)
	if err != nil {
		t.Fatalf("ffprobe reported no usable duration: %v", err)
	}
	if diff := duration - wantDuration; diff < -0.2 || diff > 0.2 {
		t.Errorf("preview runs %.2fs, want %.2fs", duration, wantDuration)
	}

	frames, err := strconv.Atoi(fields["nb_read_frames"])
	if err != nil {
		t.Fatalf("ffprobe read no frames: %v", err)
	}
	if frames < 10 {
		t.Errorf("preview holds only %d frames", frames)
	}
	t.Logf("%d frames over %.2fs", frames, duration)

	// Decoding the whole thing is what proves every sample is intact, not just
	// that the container describes them plausibly.
	if ffmpeg, err := exec.LookPath("ffmpeg"); err == nil {
		out, err := exec.Command(ffmpeg, "-v", "error", "-i", preview, "-f", "null", "-").CombinedOutput()
		if err != nil {
			t.Fatalf("ffmpeg could not decode the preview: %v\n%s", err, out)
		}
		if len(out) > 0 {
			t.Errorf("ffmpeg reported errors decoding the preview:\n%s", out)
		}
	}
}

// TestMarkerPreviewRealFile builds the other shape of preview this package is
// asked for: one twenty-second segment, with sound.
//
// It is not the same exercise as the scene preview above. A single long segment
// means one keyframe and a thousand frames after it rather than twelve short
// runs, and asking for audio means the audio track is cut to a range and placed
// against the video's, which the twelve-segment test does not check the shape of
// at all.
//
// Opt in with:
//
//	STASH_NATIVEGEN_TEST_MP4=<path> go test ./pkg/nativegen/ -run MarkerPreviewRealFile -v
func TestMarkerPreviewRealFile(t *testing.T) {
	path := os.Getenv("STASH_NATIVEGEN_TEST_MP4")
	if path == "" {
		t.Skip("set STASH_NATIVEGEN_TEST_MP4 to run")
	}
	if !Available() {
		t.Skip("no native hardware backend on this machine")
	}
	probe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is not on PATH")
	}
	t.Logf("backend: %s", Describe())

	vrMode := os.Getenv("STASH_NATIVEGEN_TEST_VRMODE")
	name := "native_marker.mp4"
	if vrMode != "" {
		name = "native_marker_" + vrMode + ".mp4"
		t.Logf("projection: %s", vrMode)
	}

	// The marker generator's own shape: twenty seconds from the mark, 640 wide,
	// a little softer than a scene preview.
	const markerStart = 60.0
	const markerDuration = 20.0
	const markerQP = 25

	var buf bytes.Buffer
	start := time.Now()
	err = Preview(context.Background(), PreviewOptions{
		Path:            path,
		Starts:          []float64{markerStart},
		SegmentDuration: markerDuration,
		Width:           testPreviewWidth,
		VRMode:          vrMode,
		QP:              markerQP,
		Audio:           true,
	}, &buf)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Preview: %v", err)
	}
	t.Logf("%s: %.0fs marker preview in %v (%d KB)", filepath.Base(path),
		markerDuration, elapsed.Round(time.Millisecond), buf.Len()/1024)

	out := os.Getenv("STASH_NATIVEGEN_TEST_OUT")
	if out == "" {
		out = t.TempDir()
	}
	preview := filepath.Join(out, name)
	if err := os.WriteFile(preview, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("writing preview: %v", err)
	}
	t.Logf("wrote %s", preview)

	info, err := exec.Command(probe, "-v", "error",
		"-show_entries", "stream=codec_type,codec_name,width,duration",
		"-of", "default=noprint_wrappers=1", preview).Output()
	if err != nil {
		t.Fatalf("ffprobe rejected the marker preview: %v", err)
	}
	t.Logf("ffprobe:\n%s", info)

	// Both streams have to be there, and the video has to run for the whole
	// twenty seconds: a segment this long is the one most likely to lose frames
	// to a reorder window, and losing them shows up as a short file.
	streams := strings.Count(string(info), "codec_type=")
	if streams != 2 {
		t.Errorf("marker preview holds %d streams, want video and audio", streams)
	}
	if !strings.Contains(string(info), "codec_type=audio") {
		t.Errorf("marker preview has no audio track")
	}

	// The video's own duration, asked for separately: a file with two streams
	// reports two of everything, and it is the video's that says whether any
	// frames were lost.
	videoInfo, err := exec.Command(probe, "-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=duration",
		"-of", "default=noprint_wrappers=1", preview).Output()
	if err != nil {
		t.Fatalf("ffprobe rejected the marker preview: %v", err)
	}
	duration, err := strconv.ParseFloat(parseProbe(string(videoInfo))["duration"], 64)
	if err != nil {
		t.Fatalf("ffprobe reported no usable duration: %v", err)
	}
	if diff := duration - markerDuration; diff < -0.2 || diff > 0.2 {
		t.Errorf("marker preview runs %.2fs, want %.0fs", duration, markerDuration)
	}

	if ffmpeg, err := exec.LookPath("ffmpeg"); err == nil {
		out, err := exec.Command(ffmpeg, "-v", "error", "-i", preview, "-f", "null", "-").CombinedOutput()
		if err != nil {
			t.Fatalf("ffmpeg could not decode the marker preview: %v\n%s", err, out)
		}
		if len(out) > 0 {
			t.Errorf("ffmpeg reported errors decoding the marker preview:\n%s", out)
		}
	}
}

func parseProbe(s string) map[string]string {
	fields := map[string]string{}
	for _, line := range strings.Split(s, "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok {
			fields[k] = v
		}
	}
	return fields
}
