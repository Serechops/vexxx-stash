package utils

import (
	"bytes"
	"io"
)

// CopyBuffered performs io.Copy using a pooled buffer.
// This reduces allocations compared to using io.Copy directly.
func CopyBuffered(dst io.Writer, src io.Reader) (int64, error) {
	bufPtr := GetCopyBuffer()
	defer PutCopyBuffer(bufPtr)
	return io.CopyBuffer(dst, src, *bufPtr)
}

// CopyNBuffered copies up to n bytes using a pooled buffer.
func CopyNBuffered(dst io.Writer, src io.Reader, n int64) (int64, error) {
	bufPtr := GetCopyBuffer()
	defer PutCopyBuffer(bufPtr)
	return io.CopyBuffer(dst, io.LimitReader(src, n), *bufPtr)
}

// ReadAllBuffered reads all data from r using a pooled buffer.
// Returns a new byte slice containing the data (caller owns the slice).
func ReadAllBuffered(r io.Reader) ([]byte, error) {
	buf := GetBuffer(MediumBufferSize)
	defer PutBuffer(buf)

	_, err := io.Copy(buf, r)
	if err != nil {
		return nil, err
	}

	// Return a copy of the bytes (buffer goes back to pool)
	result := make([]byte, buf.Len())
	copy(result, buf.Bytes())
	return result, nil
}

// ReadAllToBuffer reads all data from r into a pooled buffer.
// Caller must call PutBuffer when done with the buffer.
func ReadAllToBuffer(r io.Reader) (*bytes.Buffer, error) {
	buf := GetBuffer(MediumBufferSize)

	_, err := io.Copy(buf, r)
	if err != nil {
		PutBuffer(buf)
		return nil, err
	}

	return buf, nil
}
