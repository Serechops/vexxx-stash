package imagephash

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/corona10/goimagehash"
	"github.com/stashapp/stash/pkg/file"
	"github.com/stashapp/stash/pkg/models"
	_ "golang.org/x/image/webp"
)

// Generate computes a perceptual hash for an image file.
func Generate(imageFile *models.ImageFile) (*uint64, error) {
	img, err := loadImage(imageFile)
	if err != nil {
		return nil, fmt.Errorf("loading image: %w", err)
	}

	hash, err := goimagehash.PerceptionHash(img)
	if err != nil {
		return nil, fmt.Errorf("computing phash from image: %w", err)
	}

	hashValue := hash.GetHash()
	return &hashValue, nil
}

// loadImage loads an image from disk and decodes it.
func loadImage(imageFile *models.ImageFile) (image.Image, error) {
	reader, err := imageFile.Open(&file.OsFS{})
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(reader); err != nil {
		return nil, err
	}

	img, format, err := image.Decode(buf)
	if err != nil {
		// Provide more helpful error for unsupported formats
		if err.Error() == "image: unknown format" {
			return nil, fmt.Errorf("unsupported image format (supported: JPEG, PNG, GIF, WebP): %w", err)
		}
		return nil, fmt.Errorf("decoding image (format: %s): %w", format, err)
	}

	return img, nil
}
