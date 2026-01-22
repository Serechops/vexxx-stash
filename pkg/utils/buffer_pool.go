// Package utils provides utility functions and types.
package utils

import (
	"bytes"
	"sync"
)

// Buffer pool sizes
const (
	SmallBufferSize  = 4 * 1024   // 4KB
	MediumBufferSize = 32 * 1024  // 32KB
	LargeBufferSize  = 256 * 1024 // 256KB
	CopyBufferSize   = 32 * 1024  // 32KB for io.Copy operations
)

var (
	// smallBufferPool for buffers up to 4KB
	smallBufferPool = sync.Pool{
		New: func() interface{} {
			return bytes.NewBuffer(make([]byte, 0, SmallBufferSize))
		},
	}

	// mediumBufferPool for buffers up to 32KB
	mediumBufferPool = sync.Pool{
		New: func() interface{} {
			return bytes.NewBuffer(make([]byte, 0, MediumBufferSize))
		},
	}

	// largeBufferPool for buffers up to 256KB
	largeBufferPool = sync.Pool{
		New: func() interface{} {
			return bytes.NewBuffer(make([]byte, 0, LargeBufferSize))
		},
	}

	// copyBufferPool for io.Copy operations
	copyBufferPool = sync.Pool{
		New: func() interface{} {
			buf := make([]byte, CopyBufferSize)
			return &buf
		},
	}
)

// BufferSize represents a buffer size category
type BufferSize int

const (
	BufferSmall BufferSize = iota
	BufferMedium
	BufferLarge
)

// GetBuffer retrieves a buffer from the appropriate pool based on size hint.
// The returned buffer should be returned to the pool using PutBuffer after use.
func GetBuffer(sizeHint int) *bytes.Buffer {
	if sizeHint <= SmallBufferSize {
		return smallBufferPool.Get().(*bytes.Buffer)
	} else if sizeHint <= MediumBufferSize {
		return mediumBufferPool.Get().(*bytes.Buffer)
	}
	return largeBufferPool.Get().(*bytes.Buffer)
}

// GetBufferBySize retrieves a buffer of the specified size category.
func GetBufferBySize(size BufferSize) *bytes.Buffer {
	switch size {
	case BufferSmall:
		return smallBufferPool.Get().(*bytes.Buffer)
	case BufferMedium:
		return mediumBufferPool.Get().(*bytes.Buffer)
	case BufferLarge:
		return largeBufferPool.Get().(*bytes.Buffer)
	default:
		return smallBufferPool.Get().(*bytes.Buffer)
	}
}

// PutBuffer returns a buffer to the appropriate pool.
// The buffer is reset before being returned to the pool.
func PutBuffer(buf *bytes.Buffer) {
	if buf == nil {
		return
	}
	cap := buf.Cap()
	buf.Reset()

	// Return to appropriate pool based on capacity
	if cap <= SmallBufferSize {
		smallBufferPool.Put(buf)
	} else if cap <= MediumBufferSize {
		mediumBufferPool.Put(buf)
	} else if cap <= LargeBufferSize {
		largeBufferPool.Put(buf)
	}
	// Don't return oversized buffers to avoid memory bloat
}

// GetCopyBuffer retrieves a byte slice buffer for io.Copy operations.
// Returns a pointer to a byte slice to avoid allocations.
func GetCopyBuffer() *[]byte {
	return copyBufferPool.Get().(*[]byte)
}

// PutCopyBuffer returns a copy buffer to the pool.
func PutCopyBuffer(buf *[]byte) {
	if buf == nil || len(*buf) != CopyBufferSize {
		return
	}
	copyBufferPool.Put(buf)
}

// ByteSlicePool is a pool for byte slices of a specific size.
type ByteSlicePool struct {
	pool sync.Pool
	size int
}

// NewByteSlicePool creates a new pool for byte slices of the given size.
func NewByteSlicePool(size int) *ByteSlicePool {
	return &ByteSlicePool{
		pool: sync.Pool{
			New: func() interface{} {
				buf := make([]byte, size)
				return &buf
			},
		},
		size: size,
	}
}

// Get retrieves a byte slice from the pool.
func (p *ByteSlicePool) Get() *[]byte {
	return p.pool.Get().(*[]byte)
}

// Put returns a byte slice to the pool.
func (p *ByteSlicePool) Put(buf *[]byte) {
	if buf == nil || len(*buf) != p.size {
		return
	}
	p.pool.Put(buf)
}
