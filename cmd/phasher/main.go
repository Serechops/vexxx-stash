// TODO: document in README.md
package main

import (
	"fmt"
	"os"
	"os/exec"

	flag "github.com/spf13/pflag"
	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/hash/videophash"
	"github.com/stashapp/stash/pkg/models"
)

func customUsage() {
	fmt.Fprintf(os.Stderr, "Usage:\n")
	fmt.Fprintf(os.Stderr, "%s [OPTIONS] VIDEOFILE...\n\nOptions:\n", os.Args[0])
	flag.PrintDefaults()
}

func printPhash(ff *ffmpeg.FFMpeg, ffp *ffmpeg.FFProbe, inputfile string, quiet *bool, start float64, duration float64) error {
	ffvideoFile, err := ffp.NewVideoFile(inputfile)
	if err != nil {
		return err
	}

	// All we need for videophash.Generate() is
	// videoFile.Path (from BaseFile)
	// videoFile.Duration
	// The rest of the struct isn't needed.
	vf := &models.VideoFile{
		BaseFile: &models.BaseFile{Path: inputfile},
		Duration: ffvideoFile.FileDuration,
	}

	options := videophash.PhashOptions{
		Start:    start,
		Duration: duration,
	}

	phash, err := videophash.Generate(ff, vf, options)
	if err != nil {
		return err
	}

	if *quiet {
		fmt.Printf("%x\n", *phash)
	} else {
		fmt.Printf("%x %v\n", *phash, vf.Path)
	}
	return nil
}

func getPaths() (string, string) {
	ffmpegPath, _ := exec.LookPath("ffmpeg")
	ffprobePath, _ := exec.LookPath("ffprobe")

	return ffmpegPath, ffprobePath
}

func main() {
	flag.Usage = customUsage
	quiet := flag.BoolP("quiet", "q", false, "print only the phash")
	start := flag.Float64("start", 0, "start time in seconds")
	duration := flag.Float64("duration", 0, "duration in seconds")
	help := flag.BoolP("help", "h", false, "print this help output")
	flag.Parse()

	if *help {
		flag.Usage()
		os.Exit(2)
	}

	args := flag.Args()

	if len(args) < 1 {
		fmt.Fprintf(os.Stderr, "Missing VIDEOFILE argument.\n")
		flag.Usage()
		os.Exit(2)
	}

	if len(args) > 1 {
		fmt.Fprintln(os.Stderr, "Files will be processed sequentially! If required, use e.g. GNU Parallel to run concurrently.")
		fmt.Fprintf(os.Stderr, "Example: parallel %v ::: *.mp4\n", os.Args[0])
	}

	ffmpegPath, ffprobePath := getPaths()
	encoder := ffmpeg.NewEncoder(ffmpegPath)
	// don't need to InitHWSupport, phashing doesn't use hw acceleration
	ffprobe := ffmpeg.NewFFProbe(ffprobePath)

	for _, item := range args {
		if err := printPhash(encoder, ffprobe, item, quiet, *start, *duration); err != nil {
			fmt.Fprintln(os.Stderr, err)
		}
	}
}
