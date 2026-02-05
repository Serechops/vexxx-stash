package api

import (
	"context"
	"regexp"
	"strconv"

	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/utils"
)

// localImagePathPatterns maps known local image URL path patterns to a
// function that reads the image bytes directly from the database.
// This avoids making an HTTP request back to ourselves (which would fail
// when authentication is enabled). See stashapp/stash#5538.
var localImagePathPatterns = []struct {
	pattern *regexp.Regexp
	handler func(ctx context.Context, r *Resolver, id int) ([]byte, error)
}{
	{
		// /performer/{id}/image
		pattern: regexp.MustCompile(`^/performer/(\d+)/image$`),
		handler: func(ctx context.Context, r *Resolver, id int) ([]byte, error) {
			var image []byte
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				image, err = r.repository.Performer.GetImage(ctx, id)
				return err
			}); err != nil {
				return nil, err
			}
			return image, nil
		},
	},
	{
		// /studio/{id}/image
		pattern: regexp.MustCompile(`^/studio/(\d+)/image$`),
		handler: func(ctx context.Context, r *Resolver, id int) ([]byte, error) {
			var image []byte
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				image, err = r.repository.Studio.GetImage(ctx, id)
				return err
			}); err != nil {
				return nil, err
			}
			return image, nil
		},
	},
	{
		// /tag/{id}/image
		pattern: regexp.MustCompile(`^/tag/(\d+)/image$`),
		handler: func(ctx context.Context, r *Resolver, id int) ([]byte, error) {
			var image []byte
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				image, err = r.repository.Tag.GetImage(ctx, id)
				return err
			}); err != nil {
				return nil, err
			}
			return image, nil
		},
	},
	{
		// /scene/{id}/screenshot
		pattern: regexp.MustCompile(`^/scene/(\d+)/screenshot$`),
		handler: func(ctx context.Context, r *Resolver, id int) ([]byte, error) {
			var image []byte
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				image, err = r.repository.Scene.GetCover(ctx, id)
				return err
			}); err != nil {
				return nil, err
			}
			return image, nil
		},
	},
	{
		// /group/{id}/frontimage
		pattern: regexp.MustCompile(`^/group/(\d+)/frontimage$`),
		handler: func(ctx context.Context, r *Resolver, id int) ([]byte, error) {
			var image []byte
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				image, err = r.repository.Group.GetFrontImage(ctx, id)
				return err
			}); err != nil {
				return nil, err
			}
			return image, nil
		},
	},
	{
		// /group/{id}/backimage
		pattern: regexp.MustCompile(`^/group/(\d+)/backimage$`),
		handler: func(ctx context.Context, r *Resolver, id int) ([]byte, error) {
			var image []byte
			if err := r.withReadTxn(ctx, func(ctx context.Context) error {
				var err error
				image, err = r.repository.Group.GetBackImage(ctx, id)
				return err
			}); err != nil {
				return nil, err
			}
			return image, nil
		},
	},
}

// resolveLocalImage checks if the input string is a relative path pointing to
// a local Stash image resource (e.g. "/performer/123/image") and reads the
// image directly from the database, bypassing HTTP (and thus authentication).
//
// Returns the image bytes and true if the path matched a known local pattern.
// Returns nil, false if the input is not a recognised local path.
func (r *Resolver) resolveLocalImage(ctx context.Context, input string) ([]byte, bool) {
	// Only handle paths that start with /
	if len(input) == 0 || input[0] != '/' {
		return nil, false
	}

	for _, p := range localImagePathPatterns {
		matches := p.pattern.FindStringSubmatch(input)
		if matches == nil {
			continue
		}

		id, err := strconv.Atoi(matches[1])
		if err != nil {
			continue
		}

		image, err := p.handler(ctx, r, id)
		if err != nil {
			logger.Warnf("resolveLocalImage: error reading %s: %v", input, err)
			return nil, false
		}

		if len(image) == 0 {
			return nil, false
		}

		return image, true
	}

	return nil, false
}

// processLocalOrRemoteImage processes an image input string. If it is a
// relative path to a local Stash resource, the image is read directly from
// the database. Otherwise, the standard ProcessImageInput logic is used
// (base64 data URI or HTTP fetch).
func (r *Resolver) processLocalOrRemoteImage(ctx context.Context, imageInput string) ([]byte, error) {
	if imageInput == "" {
		return []byte{}, nil
	}

	// Try resolving as a local relative path first
	if data, ok := r.resolveLocalImage(ctx, imageInput); ok {
		return data, nil
	}

	// Fall back to existing ProcessImageInput (base64 or HTTP URL)
	return utils.ProcessImageInput(ctx, imageInput)
}
