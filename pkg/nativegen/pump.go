package nativegen

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/stashapp/stash/pkg/nativegen/amf"
)

const (
	// maxSubmitRetries bounds how many times one frame will be re-offered to a
	// full decoder before we give up and let ffmpeg have the file.
	maxSubmitRetries = 64

	// maxDrainPolls bounds the wait for frames still inside the pipeline after
	// Drain, for a decoder that neither produces output nor reports EOF.
	maxDrainPolls = 256

	// submitBackoff is how long to wait before re-offering a frame to a decoder
	// that is full and had nothing to hand back. See pump.submit for why the wait
	// is conditional.
	submitBackoff = 250 * time.Microsecond
)

// sleepBackoff waits out a component that has work in flight. It is the one
// thing to do when a queue is full and nothing is ready to come out of it.
func sleepBackoff() { time.Sleep(submitBackoff) }

// A pump drives the decoder's submit/receive protocol.
//
// The protocol is not "hand over a frame, take a frame". A hardware decoder
// accepts input into a queue and produces output on its own schedule, so the two
// sides have to be pumped independently: offer input when there is room, take
// output whenever there is any. Every caller in this package does that the same
// way, and the ordering rules are subtle enough that they should only be written
// down once.
type pump struct {
	ctx context.Context
	dec *amf.Decoder

	// place receives each decoded frame. The frame's PTS is whatever the caller
	// submitted it with, so outputs identify themselves and nothing here depends
	// on frames coming back in the order they went in.
	place func(*amf.Frame) error
}

// drain takes whatever output is ready without waiting for more, and reports how
// many frames it placed.
func (p *pump) drain() (int, error) {
	placed := 0
	for {
		fr, err := p.dec.Receive()
		switch {
		case errors.Is(err, amf.ErrNeedMoreInput), errors.Is(err, amf.ErrDrained):
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
//
// A full input queue is back-pressure rather than failure, and the way out of it
// is to take output, which frees the surfaces holding it. But the queue can also
// be full simply because the GPU has not finished: then there is no output to
// take and nothing this loop does will change that. Retrying immediately in that
// state spends the whole retry budget in a few microseconds and reports a wedged
// decoder that was merely busy — which is what "decoder input stayed full"
// turned out to be on long sequential runs.
//
// So the wait is conditional on progress. If draining produced frames the queue
// has room now and the retry is immediate; if it produced nothing, the decode is
// still running and the only useful thing to do is let it.
func (p *pump) submit(data []byte, pts int64) error {
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
		if !errors.Is(err, amf.ErrInputFull) {
			return err
		}
		if attempt >= maxSubmitRetries {
			return errors.New("decoder input stayed full")
		}

		placed, err := p.drain()
		if err != nil {
			return fmt.Errorf("draining a full decoder: %w", err)
		}
		if placed == 0 {
			time.Sleep(submitBackoff)
		}
	}
}

// finish tells the decoder no more input is coming and collects what it is still
// holding, stopping early once done reports the caller has everything it wanted.
func (p *pump) finish(done func() bool) error {
	if err := p.dec.Drain(); err != nil {
		return err
	}

	for i := 0; i < maxDrainPolls && !done(); i++ {
		fr, err := p.dec.Receive()
		switch {
		case errors.Is(err, amf.ErrDrained):
			return nil
		case errors.Is(err, amf.ErrNeedMoreInput):
			// The pipeline has not emptied yet. Unlike the submit path there is
			// no input left to add, so waiting is the only move.
			time.Sleep(submitBackoff)
			continue
		case err != nil:
			return err
		}
		if err := p.place(fr); err != nil {
			return err
		}
	}
	return nil
}
