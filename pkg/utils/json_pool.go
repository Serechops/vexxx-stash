package utils

import (
	"bytes"
	"encoding/json"
	"io"
	"sync"
)

var jsonEncoderPool = sync.Pool{
	New: func() interface{} {
		return bytes.NewBuffer(make([]byte, 0, 4096))
	},
}

// MarshalJSONPooled marshals v to JSON using a pooled buffer.
// This reduces allocations compared to json.Marshal.
func MarshalJSONPooled(v interface{}) ([]byte, error) {
	buf := jsonEncoderPool.Get().(*bytes.Buffer)
	defer func() {
		buf.Reset()
		jsonEncoderPool.Put(buf)
	}()

	enc := json.NewEncoder(buf)
	enc.SetEscapeHTML(false) // Slightly faster, matches json.Marshal behavior for most cases
	if err := enc.Encode(v); err != nil {
		return nil, err
	}

	// json.Encoder adds a trailing newline, remove it to match json.Marshal
	result := buf.Bytes()
	if len(result) > 0 && result[len(result)-1] == '\n' {
		result = result[:len(result)-1]
	}

	// Return a copy since buffer goes back to pool
	return append([]byte(nil), result...), nil
}

// WriteJSONPooled writes v as JSON to w using a pooled buffer.
// This is more efficient than json.NewEncoder(w).Encode(v) for small payloads
// as it allows buffer reuse.
func WriteJSONPooled(w io.Writer, v interface{}) error {
	buf := jsonEncoderPool.Get().(*bytes.Buffer)
	defer func() {
		buf.Reset()
		jsonEncoderPool.Put(buf)
	}()

	enc := json.NewEncoder(buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return err
	}

	_, err := w.Write(buf.Bytes())
	return err
}

// UnmarshalJSONPooled unmarshals JSON data into v.
// Currently this is just a wrapper around json.Unmarshal but provides
// a consistent API and could be optimized in the future.
func UnmarshalJSONPooled(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

// JSONBuffer wraps a bytes.Buffer with JSON encoding methods.
// Get one via GetJSONBuffer and return it with PutJSONBuffer.
type JSONBuffer struct {
	buf *bytes.Buffer
	enc *json.Encoder
}

var jsonBufferPool = sync.Pool{
	New: func() interface{} {
		buf := bytes.NewBuffer(make([]byte, 0, 4096))
		enc := json.NewEncoder(buf)
		enc.SetEscapeHTML(false)
		return &JSONBuffer{buf: buf, enc: enc}
	},
}

// GetJSONBuffer retrieves a JSONBuffer from the pool.
func GetJSONBuffer() *JSONBuffer {
	return jsonBufferPool.Get().(*JSONBuffer)
}

// PutJSONBuffer returns a JSONBuffer to the pool.
func PutJSONBuffer(jb *JSONBuffer) {
	if jb == nil {
		return
	}
	jb.buf.Reset()
	jsonBufferPool.Put(jb)
}

// Encode encodes v as JSON into the buffer.
func (jb *JSONBuffer) Encode(v interface{}) error {
	return jb.enc.Encode(v)
}

// Bytes returns the buffer contents.
func (jb *JSONBuffer) Bytes() []byte {
	return jb.buf.Bytes()
}

// BytesWithoutNewline returns the buffer contents without trailing newline.
func (jb *JSONBuffer) BytesWithoutNewline() []byte {
	b := jb.buf.Bytes()
	if len(b) > 0 && b[len(b)-1] == '\n' {
		return b[:len(b)-1]
	}
	return b
}

// Reset clears the buffer for reuse.
func (jb *JSONBuffer) Reset() {
	jb.buf.Reset()
}

// WriteTo writes the buffer contents to w.
func (jb *JSONBuffer) WriteTo(w io.Writer) (int64, error) {
	return jb.buf.WriteTo(w)
}
