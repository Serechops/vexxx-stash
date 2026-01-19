package recommendation

import (
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/stashbox"
)

type Engine struct {
	SceneRepo      models.SceneReaderWriter
	PerformerRepo  models.PerformerReaderWriter
	StudioRepo     models.StudioReaderWriter
	TagRepo        models.TagReaderWriter
	GalleryRepo    models.GalleryReaderWriter
	ImageRepo      models.ImageReaderWriter
	ContentProfile models.ContentProfileReaderWriter

	StashBoxClient *stashbox.Client
}

func NewEngine(
	sceneRepo models.SceneReaderWriter,
	performerRepo models.PerformerReaderWriter,
	studioRepo models.StudioReaderWriter,
	tagRepo models.TagReaderWriter,
	galleryRepo models.GalleryReaderWriter,
	imageRepo models.ImageReaderWriter,
	contentProfile models.ContentProfileReaderWriter,
	stashBoxClient *stashbox.Client,
) *Engine {
	return &Engine{
		SceneRepo:      sceneRepo,
		PerformerRepo:  performerRepo,
		StudioRepo:     studioRepo,
		TagRepo:        tagRepo,
		GalleryRepo:    galleryRepo,
		ImageRepo:      imageRepo,
		ContentProfile: contentProfile,
		StashBoxClient: stashBoxClient,
	}
}
