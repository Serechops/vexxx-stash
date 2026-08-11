package manager

import (
	"github.com/stashapp/stash/internal/manager/config"
)

type SystemStatus struct {
	DatabaseSchema *int             `json:"databaseSchema"`
	DatabasePath   *string          `json:"databasePath"`
	ConfigPath     *string          `json:"configPath"`
	AppSchema      int              `json:"appSchema"`
	Status         SystemStatusEnum `json:"status"`
	Os             string           `json:"os"`
	WorkingDir     string           `json:"working_dir"`
	HomeDir        string           `json:"home_dir"`
	FfmpegPath     *string          `json:"ffmpegPath"`
	FfprobePath    *string          `json:"ffprobePath"`
	VipsPath       *string          `json:"vipsPath"`
	IsDocker       bool             `json:"isDocker"`
	HardwareCodecs []string         `json:"hardwareCodecs"`

	// NativeGenerationBackend names the backend pkg/nativegen would use here,
	// and is empty when there is none. It sits beside VipsPath and
	// HardwareCodecs because it answers the same kind of question: what this
	// machine can actually do, as opposed to what it has been asked to do.
	NativeGenerationBackend string `json:"nativeGenerationBackend"`
}

type SetupInput struct {
	// Empty to indicate $HOME/.stash/config.yml default
	ConfigLocation string                     `json:"configLocation"`
	Stashes        []*config.StashConfigInput `json:"stashes"`
	SFWContentMode bool                       `json:"sfwContentMode"`
	// Empty to indicate default
	DatabaseFile string `json:"databaseFile"`
	// Empty to indicate default
	GeneratedLocation string `json:"generatedLocation"`
	// Empty to indicate default
	CacheLocation string `json:"cacheLocation"`

	StoreBlobsInDatabase bool `json:"storeBlobsInDatabase"`
	// Empty to indicate default
	BlobsLocation string `json:"blobsLocation"`
}

type MigrateInput struct {
	BackupPath string `json:"backupPath"`
}
