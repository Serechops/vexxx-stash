package pkg

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/python"
)

// SourcePathGetter gets the source path for a given package URL.
type SourcePathGetter interface {
	// GetAllSourcePaths gets all source paths.
	GetAllSourcePaths() []string

	// GetSourcePath gets the source path for the given package URL.
	GetSourcePath(srcURL string) string
}

// Manager manages the installation of paks.
type Manager struct {
	Local             *Store
	PackagePathGetter SourcePathGetter

	Client *http.Client

	// PythonPath is the configured path to the Python executable.
	// Used to install Python dependencies via pip.
	PythonPath string

	cache *repositoryCache
}

func (m *Manager) getCache() *repositoryCache {
	if m.cache == nil {
		m.cache = &repositoryCache{}
	}

	return m.cache
}

func (m *Manager) remoteFromURL(path string) (*httpRepository, error) {
	u, err := url.Parse(path)
	if err != nil {
		return nil, fmt.Errorf("parsing path: %w", err)
	}

	return newHttpRepository(*u, m.Client, m.getCache()), nil
}

func (m *Manager) ListInstalled(ctx context.Context) (LocalPackageIndex, error) {
	paths := m.PackagePathGetter.GetAllSourcePaths()

	var installedList []Manifest

	for _, p := range paths {
		store := m.Local.sub(p)

		srcList, err := store.List(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing local packages: %w", err)
		}

		installedList = append(installedList, srcList...)
	}

	return localPackageIndexFromList(installedList), nil
}

func (m *Manager) ListRemote(ctx context.Context, remoteURL string) (RemotePackageIndex, error) {
	r, err := m.remoteFromURL(remoteURL)
	if err != nil {
		return nil, fmt.Errorf("creating remote repository: %w", err)
	}

	list, err := r.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing remote packages: %w", err)
	}

	// add link to RemotePackage
	for i := range list {
		list[i].Repository = r
	}

	ret := remotePackageIndexFromList(list)

	return ret, nil
}

func (m *Manager) ListInstalledRemotes(ctx context.Context, installed LocalPackageIndex) (RemotePackageIndex, error) {
	// get remotes for all installed packages
	allRemoteList := make(RemotePackageIndex)

	remoteURLs := installed.remoteURLs()
	for _, remoteURL := range remoteURLs {
		remoteList, err := m.ListRemote(ctx, remoteURL)
		if err != nil {
			logger.Warnf("error listing remote package %s: %v", remoteURL, err)
			continue
		}

		allRemoteList.merge(remoteList)
	}

	return allRemoteList, nil
}

func (m *Manager) InstalledStatus(ctx context.Context) (PackageStatusIndex, error) {
	// get all installed packages
	installed, err := m.ListInstalled(ctx)
	if err != nil {
		return nil, err
	}

	// get remotes for all installed packages
	allRemoteList, err := m.ListInstalledRemotes(ctx, installed)
	if err != nil {
		return nil, err
	}

	ret := MakePackageStatusIndex(installed, allRemoteList)

	return ret, nil
}

func (m *Manager) packageByID(ctx context.Context, spec models.PackageSpecInput) (*RemotePackage, error) {
	l, err := m.ListRemote(ctx, spec.SourceURL)
	if err != nil {
		return nil, err
	}

	pkg, found := l[spec]
	if !found {
		return nil, nil
	}

	return &pkg, nil
}

func (m *Manager) getStore(remoteURL string) *Store {
	srcPath := m.PackagePathGetter.GetSourcePath(remoteURL)
	store := m.Local.sub(srcPath)

	return store
}

func (m *Manager) Install(ctx context.Context, spec models.PackageSpecInput) error {
	remote, err := m.remoteFromURL(spec.SourceURL)
	if err != nil {
		return fmt.Errorf("creating remote repository: %w", err)
	}

	pkg, err := m.packageByID(ctx, spec)
	if err != nil {
		return fmt.Errorf("getting remote package: %w", err)
	}

	fromRemote, err := remote.GetPackageZip(ctx, *pkg)
	if err != nil {
		return fmt.Errorf("getting remote package: %w", err)
	}

	defer fromRemote.Close()

	d, err := io.ReadAll(fromRemote)
	if err != nil {
		return fmt.Errorf("reading package data: %w", err)
	}

	sha := fmt.Sprintf("%x", sha256.Sum256(d))
	if sha != pkg.Sha256 {
		return fmt.Errorf("package data (%s) does not match expected SHA256 (%s)", sha, pkg.Sha256)
	}

	zr, err := zip.NewReader(bytes.NewReader(d), int64(len(d)))
	if err != nil {
		return fmt.Errorf("reading zip data: %w", err)
	}

	store := m.getStore(spec.SourceURL)

	// uninstall existing package if present
	if _, err := store.getManifest(ctx, pkg.ID); err == nil {
		if err := m.deletePackageFiles(ctx, store, pkg.ID); err != nil {
			return fmt.Errorf("uninstalling existing package: %w", err)
		}
	}

	if err := m.installPackage(*pkg, store, zr); err != nil {
		return fmt.Errorf("installing package: %w", err)
	}

	// Resolve Python dependencies if requirements.txt exists
	packageDir := store.packageDir(pkg.ID)
	if err := m.resolvePythonDependencies(ctx, pkg.ID, packageDir); err != nil {
		logger.Warnf("failed to install Python dependencies for %s: %v", pkg.ID, err)
	}

	return nil
}

func (m *Manager) installPackage(pkg RemotePackage, store *Store, zr *zip.Reader) error {
	manifest := Manifest{
		ID:             pkg.ID,
		Name:           pkg.Name,
		Metadata:       pkg.Metadata,
		PackageVersion: pkg.PackageVersion,
		RepositoryURL:  pkg.Repository.Path(),
	}

	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}

		i, err := f.Open()
		if err != nil {
			return err
		}

		fn := filepath.Clean(f.Name)
		if err := store.writeFile(pkg.ID, fn, f.Mode(), i); err != nil {
			i.Close()
			return fmt.Errorf("writing file %q: %w", fn, err)
		}

		i.Close()
		manifest.Files = append(manifest.Files, fn)
	}

	if err := store.writeManifest(pkg.ID, manifest); err != nil {
		return fmt.Errorf("writing manifest: %w", err)
	}

	return nil
}

// Uninstall uninstalls the given package.
func (m *Manager) Uninstall(ctx context.Context, spec models.PackageSpecInput) error {
	store := m.getStore(spec.SourceURL)

	if err := m.deletePackageFiles(ctx, store, spec.ID); err != nil {
		return fmt.Errorf("deleting local package: %w", err)
	}

	// also delete the directory
	// ignore errors
	_ = store.deletePackageDir(spec.ID)

	return nil
}

func (m *Manager) deletePackageFiles(ctx context.Context, store *Store, id string) error {
	manifest, err := store.getManifest(ctx, id)
	if err != nil {
		return fmt.Errorf("getting manifest: %w", err)
	}

	for _, f := range manifest.Files {
		if err := store.deleteFile(id, f); err != nil {
			// ignore
			continue
		}
	}

	if err := store.deleteManifest(id); err != nil {
		return fmt.Errorf("deleting manifest: %w", err)
	}

	return nil
}

// resolvePythonDependencies checks for a requirements.txt in the package directory
// and installs dependencies using pip if found.
func (m *Manager) resolvePythonDependencies(ctx context.Context, pkgID, packageDir string) error {
	if m.PythonPath == "" {
		// No Python configured, skip
		return nil
	}

	requirementsPath := filepath.Join(packageDir, "requirements.txt")
	if _, err := os.Stat(requirementsPath); err == nil {
		logger.Infof("Installing Python dependencies for plugin %s", pkgID)

		py, err := python.Resolve(m.PythonPath)
		if err != nil {
			return fmt.Errorf("resolving python: %w", err)
		}

		if err := py.CheckAndInstallRequirements(ctx, requirementsPath); err != nil {
			return fmt.Errorf("installing requirements: %w", err)
		}

		// Success
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("checking requirements.txt: %w", err)
	}

	// No requirements.txt, try fallback scanning
	return m.scanAndInstallDependencies(ctx, pkgID, packageDir)
}

func (m *Manager) scanAndInstallDependencies(ctx context.Context, pkgID, packageDir string) error {
	logger.Debugf("Scanning Python dependencies for plugin %s", pkgID)

	imports := make(map[string]struct{})
	importRegex := regexp.MustCompile(`(?m)^(?:from|import)\s+(\w+)`)

	err := filepath.WalkDir(packageDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".py") {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			logger.Warnf("failed to read file %s: %v", path, err)
			return nil
		}

		matches := importRegex.FindAllStringSubmatch(string(content), -1)
		for _, match := range matches {
			if len(match) > 1 {
				imports[match[1]] = struct{}{}
			}
		}
		return nil
	})

	if err != nil {
		return fmt.Errorf("scanning plugin files: %w", err)
	}

	if len(imports) == 0 {
		return nil
	}

	var candidates []string
	for imp := range imports {
		candidates = append(candidates, imp)
	}

	py, err := python.Resolve(m.PythonPath)
	if err != nil {
		return fmt.Errorf("resolving python: %w", err)
	}

	missing, err := py.CheckModules(ctx, candidates)
	if err != nil {
		return fmt.Errorf("checking modules: %w", err)
	}

	if len(missing) == 0 {
		logger.Debugf("All detected Python dependencies for plugin %s are satisfied", pkgID)
		return nil
	}

	logger.Infof("Installing detected missing Python dependencies for plugin %s: %v", pkgID, missing)

	for _, mod := range missing {
		if err := py.PipInstall(ctx, mod); err != nil {
			logger.Errorf("Failed to install module %s for plugin %s: %v", mod, pkgID, err)
			// Continue trying others
		}
	}

	return nil
}
