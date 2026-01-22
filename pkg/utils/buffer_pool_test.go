package utils

import (
	"bytes"
	"io"
	"strings"
	"sync"
	"testing"
)

func TestGetBuffer(t *testing.T) {
	tests := []struct {
		name     string
		sizeHint int
		minCap   int
	}{
		{"small buffer", 1024, SmallBufferSize},
		{"medium buffer", 10 * 1024, MediumBufferSize},
		{"large buffer", 100 * 1024, LargeBufferSize},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf := GetBuffer(tt.sizeHint)
			if buf == nil {
				t.Fatal("GetBuffer returned nil")
			}
			if buf.Cap() < tt.minCap {
				t.Errorf("buffer capacity = %d, want >= %d", buf.Cap(), tt.minCap)
			}
			PutBuffer(buf)
		})
	}
}

func TestBufferPoolConcurrency(t *testing.T) {
	const goroutines = 100
	const iterations = 1000

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				buf := GetBuffer(1024)
				buf.WriteString("test data")
				PutBuffer(buf)
			}
		}()
	}

	wg.Wait()
}

func TestGetBufferBySize(t *testing.T) {
	sizes := []BufferSize{BufferSmall, BufferMedium, BufferLarge}
	expectedCaps := []int{SmallBufferSize, MediumBufferSize, LargeBufferSize}

	for i, size := range sizes {
		buf := GetBufferBySize(size)
		if buf.Cap() < expectedCaps[i] {
			t.Errorf("BufferSize %d: cap = %d, want >= %d", size, buf.Cap(), expectedCaps[i])
		}
		PutBuffer(buf)
	}
}

func TestPutBufferNil(t *testing.T) {
	// Should not panic
	PutBuffer(nil)
}

func TestPutBufferOversized(t *testing.T) {
	// Oversized buffers should not be returned to pool
	buf := bytes.NewBuffer(make([]byte, 0, LargeBufferSize*2))
	PutBuffer(buf) // Should not panic
}

func TestByteSlicePool(t *testing.T) {
	pool := NewByteSlicePool(1024)

	buf := pool.Get()
	if buf == nil {
		t.Fatal("pool.Get() returned nil")
	}
	if len(*buf) != 1024 {
		t.Errorf("buffer length = %d, want 1024", len(*buf))
	}

	pool.Put(buf)
}

func TestByteSlicePoolWrongSize(t *testing.T) {
	pool := NewByteSlicePool(1024)

	// Getting and putting back correctly sized buffer
	buf := pool.Get()
	pool.Put(buf)

	// Wrong size buffer should be silently ignored
	wrongBuf := make([]byte, 512)
	pool.Put(&wrongBuf)
}

func TestCopyBuffered(t *testing.T) {
	data := "Hello, World!"
	src := strings.NewReader(data)
	var dst bytes.Buffer

	n, err := CopyBuffered(&dst, src)
	if err != nil {
		t.Fatalf("CopyBuffered failed: %v", err)
	}
	if n != int64(len(data)) {
		t.Errorf("copied %d bytes, want %d", n, len(data))
	}
	if dst.String() != data {
		t.Errorf("copied data = %q, want %q", dst.String(), data)
	}
}

func TestCopyNBuffered(t *testing.T) {
	data := "Hello, World!"
	src := strings.NewReader(data)
	var dst bytes.Buffer

	n, err := CopyNBuffered(&dst, src, 5)
	if err != nil {
		t.Fatalf("CopyNBuffered failed: %v", err)
	}
	if n != 5 {
		t.Errorf("copied %d bytes, want 5", n)
	}
	if dst.String() != "Hello" {
		t.Errorf("copied data = %q, want %q", dst.String(), "Hello")
	}
}

func TestReadAllBuffered(t *testing.T) {
	data := "Hello, World!"
	src := strings.NewReader(data)

	result, err := ReadAllBuffered(src)
	if err != nil {
		t.Fatalf("ReadAllBuffered failed: %v", err)
	}
	if string(result) != data {
		t.Errorf("read data = %q, want %q", string(result), data)
	}
}

func TestReadAllToBuffer(t *testing.T) {
	data := "Hello, World!"
	src := strings.NewReader(data)

	buf, err := ReadAllToBuffer(src)
	if err != nil {
		t.Fatalf("ReadAllToBuffer failed: %v", err)
	}
	defer PutBuffer(buf)

	if buf.String() != data {
		t.Errorf("read data = %q, want %q", buf.String(), data)
	}
}

func BenchmarkGetPutBuffer(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		buf := GetBuffer(1024)
		buf.WriteString("test data")
		PutBuffer(buf)
	}
}

func BenchmarkNewBuffer(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		buf := bytes.NewBuffer(make([]byte, 0, SmallBufferSize))
		buf.WriteString("test data")
		_ = buf
	}
}

func BenchmarkCopyBuffered(b *testing.B) {
	data := make([]byte, 32*1024)
	for i := range data {
		data[i] = byte(i)
	}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		src := bytes.NewReader(data)
		dst := GetBuffer(len(data))
		CopyBuffered(dst, src)
		PutBuffer(dst)
	}
}

func BenchmarkIoCopy(b *testing.B) {
	data := make([]byte, 32*1024)
	for i := range data {
		data[i] = byte(i)
	}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		src := bytes.NewReader(data)
		var dst bytes.Buffer
		io.Copy(&dst, src)
	}
}
