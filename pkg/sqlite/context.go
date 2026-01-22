package sqlite

import (
	"context"
	"time"
)

// Default query timeouts
const (
	// DefaultQueryTimeout is the default timeout for read queries
	DefaultQueryTimeout = 30 * time.Second
	// DefaultWriteTimeout is the default timeout for write operations
	DefaultWriteTimeout = 60 * time.Second
	// DefaultLongQueryTimeout is for operations that may take longer (e.g., scanning)
	DefaultLongQueryTimeout = 5 * time.Minute
)

// QueryTimeouts holds configurable timeout values for different query types.
type QueryTimeouts struct {
	Query     time.Duration
	Write     time.Duration
	LongQuery time.Duration
}

// DefaultQueryTimeouts returns the default timeout configuration.
func DefaultQueryTimeouts() QueryTimeouts {
	return QueryTimeouts{
		Query:     DefaultQueryTimeout,
		Write:     DefaultWriteTimeout,
		LongQuery: DefaultLongQueryTimeout,
	}
}

// WithQueryTimeout returns a context with the default query timeout applied.
// If the context already has a shorter deadline, that deadline is preserved.
func WithQueryTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return withTimeout(ctx, DefaultQueryTimeout)
}

// WithWriteTimeout returns a context with the default write timeout applied.
func WithWriteTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return withTimeout(ctx, DefaultWriteTimeout)
}

// WithLongQueryTimeout returns a context with a longer timeout for slow operations.
func WithLongQueryTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return withTimeout(ctx, DefaultLongQueryTimeout)
}

// WithTimeout returns a context with the specified timeout.
// If the context already has a shorter deadline, that deadline is preserved.
func WithTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return withTimeout(ctx, timeout)
}

func withTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	// Check if context already has a deadline
	if deadline, ok := ctx.Deadline(); ok {
		// If existing deadline is sooner than our timeout, just return context as-is
		if time.Until(deadline) < timeout {
			return ctx, func() {}
		}
	}
	return context.WithTimeout(ctx, timeout)
}

// ContextWithBatchTimeout returns a context suitable for batch operations.
// The timeout scales with the number of items to process.
func ContextWithBatchTimeout(ctx context.Context, itemCount int, timePerItem time.Duration, minTimeout time.Duration) (context.Context, context.CancelFunc) {
	timeout := time.Duration(itemCount) * timePerItem
	if timeout < minTimeout {
		timeout = minTimeout
	}
	return withTimeout(ctx, timeout)
}
