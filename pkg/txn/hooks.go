package txn

import (
	"context"
)

type key int

const (
	hookManagerKey key = iota + 1
)

type hookManager struct {
	parent            *hookManager
	preCommitHooks    []TxnFunc
	postCommitHooks   []MustFunc
	postRollbackHooks []MustFunc
	postCompleteHooks []MustFunc
}

func (m *hookManager) register(ctx context.Context) context.Context {
	return context.WithValue(ctx, hookManagerKey, m)
}

func hookManagerCtx(ctx context.Context) *hookManager {
	m, ok := ctx.Value(hookManagerKey).(*hookManager)
	if !ok {
		return nil
	}
	return m
}

func executeHooks(ctx context.Context, hooks []TxnFunc) error {
	// we need to return the first error
	for _, h := range hooks {
		if err := h(ctx); err != nil {
			return err
		}
	}

	return nil
}

func executeMustHooks(ctx context.Context, hooks []MustFunc) {
	for _, h := range hooks {
		h(ctx)
	}
}

func (m *hookManager) executePostCommitHooks(ctx context.Context) {
	if m.parent != nil {
		m.parent.postCommitHooks = append(m.parent.postCommitHooks, m.postCommitHooks...)
		return
	}
	executeMustHooks(ctx, m.postCommitHooks)
}

func (m *hookManager) executePostRollbackHooks(ctx context.Context) {
	if m.parent != nil {
		m.parent.postRollbackHooks = append(m.parent.postRollbackHooks, m.postRollbackHooks...)
		return
	}
	executeMustHooks(ctx, m.postRollbackHooks)
}

func (m *hookManager) executePreCommitHooks(ctx context.Context) error {
	if m.parent != nil {
		m.parent.preCommitHooks = append(m.parent.preCommitHooks, m.preCommitHooks...)
		return nil
	}
	return executeHooks(ctx, m.preCommitHooks)
}

func (m *hookManager) executePostCompleteHooks(ctx context.Context) {
	if m.parent != nil {
		m.parent.postCompleteHooks = append(m.parent.postCompleteHooks, m.postCompleteHooks...)
		return
	}
	executeMustHooks(ctx, m.postCompleteHooks)
}

func AddPreCommitHook(ctx context.Context, hook TxnFunc) {
	m := hookManagerCtx(ctx)
	m.preCommitHooks = append(m.preCommitHooks, hook)
}

func AddPostCommitHook(ctx context.Context, hook MustFunc) {
	m := hookManagerCtx(ctx)
	m.postCommitHooks = append(m.postCommitHooks, hook)
}

func AddPostRollbackHook(ctx context.Context, hook MustFunc) {
	m := hookManagerCtx(ctx)
	m.postRollbackHooks = append(m.postRollbackHooks, hook)
}

func AddPostCompleteHook(ctx context.Context, hook MustFunc) {
	m := hookManagerCtx(ctx)
	m.postCompleteHooks = append(m.postCompleteHooks, hook)
}
