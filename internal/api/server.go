package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	gqlHandler "github.com/99designs/gqlgen/graphql/handler"
	gqlExtension "github.com/99designs/gqlgen/graphql/handler/extension"
	gqlLru "github.com/99designs/gqlgen/graphql/handler/lru"
	gqlTransport "github.com/99designs/gqlgen/graphql/handler/transport"
	gqlPlayground "github.com/99designs/gqlgen/graphql/playground"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httplog"
	"github.com/gorilla/websocket"
	"github.com/vearutop/statigz"
	"github.com/vektah/gqlparser/v2/ast"

	apiDebug "github.com/stashapp/stash/internal/api/debug"
	"github.com/stashapp/stash/internal/api/loaders"
	"github.com/stashapp/stash/internal/build"
	"github.com/stashapp/stash/internal/faptap"
	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/internal/manager/config"
	"github.com/stashapp/stash/internal/pmvhaven"
	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/megaface"
	"github.com/stashapp/stash/pkg/metrics"
	"github.com/stashapp/stash/pkg/plugin"
	"github.com/stashapp/stash/pkg/stashface"
	"github.com/stashapp/stash/pkg/stashtag"
	"github.com/stashapp/stash/pkg/tlscert"
	"github.com/stashapp/stash/pkg/utils"
	"github.com/stashapp/stash/ui"
)

const (
	loginEndpoint       = "/login"
	loginLocaleEndpoint = loginEndpoint + "/locale"
	logoutEndpoint      = "/logout"
	gqlEndpoint         = "/graphql"
	playgroundEndpoint  = "/playground"
)

type Server struct {
	http.Server
	displayAddress string

	manager *manager.Manager

	stashFaceController *stashface.Controller
	stashTagController  *stashtag.Controller
	megaFaceController  *megaface.Controller

	// Auto local-HTTPS: a second listener on its own port serving an
	// auto-generated self-signed cert (for WebXR on the LAN without a tunnel).
	httpsMu     sync.Mutex
	httpsServer *http.Server
	httpsPort   int
	httpsErr    string
}

// TODO - os.DirFS doesn't implement ReadDir, so re-implement it here
// This can be removed when we upgrade go
type osFS string

func (dir osFS) ReadDir(name string) ([]os.DirEntry, error) {
	fullname := string(dir) + "/" + name
	entries, err := os.ReadDir(fullname)
	if err != nil {
		var e *os.PathError
		if errors.As(err, &e) {
			// See comment in dirFS.Open.
			e.Path = name
		}
		return nil, err
	}
	return entries, nil
}

func (dir osFS) Open(name string) (fs.File, error) {
	return os.DirFS(string(dir)).Open(name)
}

// Initialize creates a new [Server] instance.
// It assumes that the [manager.Manager] instance has been initialised.
func Initialize() (*Server, error) {
	mgr := manager.GetInstance()
	cfg := mgr.Config

	initCustomPerformerImages(cfg.GetCustomPerformerImageLocation())

	displayHost := cfg.GetHost()
	if displayHost == "0.0.0.0" {
		displayHost = "localhost"
	}
	displayAddress := displayHost + ":" + strconv.Itoa(cfg.GetPort())

	address := cfg.GetHost() + ":" + strconv.Itoa(cfg.GetPort())
	tlsConfig, err := makeTLSConfig(cfg)
	if err != nil {
		// assume we don't want to start with a broken TLS configuration
		return nil, fmt.Errorf("error loading TLS config: %v", err)
	}

	if tlsConfig != nil {
		displayAddress = "https://" + displayAddress + "/"
	} else {
		displayAddress = "http://" + displayAddress + "/"
	}

	r := chi.NewRouter()

	server := &Server{
		Server: http.Server{
			Addr:      address,
			Handler:   r,
			TLSConfig: tlsConfig,
			// disable http/2 support by default
			// when http/2 is enabled, we are unable to hijack and close
			// the connection/request. This is necessary to stop running
			// streams when deleting a scene file.
			TLSNextProto: make(map[string]func(*http.Server, *tls.Conn, http.Handler)),
		},
		displayAddress: displayAddress,
		manager:        mgr,
		stashFaceController: stashface.NewController(
			cfg.GetPythonPath(),
			filepath.Join(cfg.GetGeneratedPath(), "stashface"),
		),
		stashTagController: stashtag.NewController(
			cfg.GetPythonPath(),
			filepath.Join(cfg.GetGeneratedPath(), "stashtag"),
		),
		megaFaceController: megaface.NewController(
			cfg.GetPythonPath(),
			filepath.Join(cfg.GetGeneratedPath(), "megaface"),
		),
	}

	r.Use(middleware.Heartbeat("/healthz"))
	r.Use(cors.AllowAll().Handler)
	r.Use(authenticateHandler())
	visitedPluginHandler := mgr.SessionStore.VisitedPluginHandler()
	r.Use(visitedPluginHandler)

	r.Use(middleware.Recoverer)
	r.Use(middleware.GetHead)

	if cfg.GetLogAccess() {
		httpLogger := httplog.NewLogger("Stash", httplog.Options{
			Concise: true,
		})
		r.Use(httplog.RequestLogger(httpLogger))
	}
	r.Use(SecurityHeadersMiddleware)
	r.Use(mediaAwareCompress(4))
	r.Use(middleware.StripSlashes)
	r.Use(BaseURLMiddleware)

	recoverFunc := func(ctx context.Context, err interface{}) error {
		logger.Error(err)
		debug.PrintStack()

		message := fmt.Sprintf("Internal system error. Error <%v>", err)
		return errors.New(message)
	}

	repo := mgr.Repository

	dataloaders := loaders.Middleware{
		Repository: repo,
	}

	r.Use(dataloaders.Middleware)

	pluginCache := mgr.PluginCache
	sceneService := mgr.SceneService
	imageService := mgr.ImageService
	galleryService := mgr.GalleryService
	groupService := mgr.GroupService
	resolver := &Resolver{
		repository:     repo,
		sceneService:   sceneService,
		imageService:   imageService,
		galleryService: galleryService,
		groupService:   groupService,
		hookExecutor:   pluginCache,
	}

	gqlSrv := gqlHandler.New(NewExecutableSchema(Config{Resolvers: resolver}))
	gqlSrv.SetRecoverFunc(recoverFunc)

	// Add mutation authorization middleware for multi-user support
	gqlSrv.AroundOperations(MutationMiddleware(repo.User, repo.TxnManager))

	gqlSrv.AddTransport(gqlTransport.Websocket{
		Upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		KeepAlivePingInterval: 10 * time.Second,
	})
	gqlSrv.AddTransport(gqlTransport.Options{})
	gqlSrv.AddTransport(gqlTransport.GET{})
	gqlSrv.AddTransport(gqlTransport.POST{})
	gqlSrv.AddTransport(gqlTransport.MultipartForm{
		MaxUploadSize: cfg.GetMaxUploadSize(),
	})

	gqlSrv.SetQueryCache(gqlLru.New[*ast.QueryDocument](1000))
	gqlSrv.Use(gqlExtension.Introspection{})

	// Limit query complexity to prevent abuse from deeply nested or
	// excessively complex queries. The limit of 750 is generous enough
	// for normal UI usage but prevents runaway recursive relation traversal
	// (e.g., Scene → Performers → Scenes → Performers → ...).
	gqlSrv.Use(gqlExtension.FixedComplexityLimit(750))

	gqlSrv.SetErrorPresenter(gqlErrorHandler)

	gqlHandlerFunc := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		gqlSrv.ServeHTTP(w, r)
	}

	// register GQL handler with plugin cache
	// chain the visited plugin handler
	// also requires the dataloader middleware
	gqlHandler := visitedPluginHandler(dataloaders.Middleware(http.HandlerFunc(gqlHandlerFunc)))
	pluginCache.RegisterGQLHandler(gqlHandler)

	r.HandleFunc(gqlEndpoint, gqlHandlerFunc)
	r.HandleFunc(playgroundEndpoint, func(w http.ResponseWriter, r *http.Request) {
		setPageSecurityHeaders(w, r, pluginCache.ListPlugins())
		endpoint := getProxyPrefix(r) + gqlEndpoint
		gqlPlayground.Handler("GraphQL playground", endpoint, gqlPlayground.WithGraphiqlEnablePluginExplorer(true))(w, r)
	})

	r.Mount("/performer", server.getPerformerRoutes())
	r.Mount("/scene", server.getSceneRoutes())
	r.Mount("/gallery", server.getGalleryRoutes())
	r.Mount("/image", server.getImageRoutes())
	r.Mount("/studio", server.getStudioRoutes())
	r.Mount("/group", server.getGroupRoutes())
	r.Mount("/tag", server.getTagRoutes())
	r.Mount("/downloads", server.getDownloadsRoutes())
	r.Mount("/faptap", server.getFaptapRoutes())
	r.Mount("/pmvhaven", server.getPmvhavenRoutes())
	r.Mount("/plugin", server.getPluginRoutes())
	r.Mount("/scheduled-tasks", server.getScheduledTaskRoutes())
	r.Mount("/proxy", server.getProxyRoutes())
	r.Mount("/stashface", server.getStashFaceRoutes())
	r.Mount("/stashtag", server.getStashTagRoutes())
	r.Mount("/megaface", server.getMegaFaceRoutes())
	r.Mount("/handy", server.getHandyRoutes())

	// DeoVR routes — grouped under /deovr prefix so tunnel sub-paths
	// are resolved before the catch-all /* UI handler.
	vr := vrRoutes{
		routes:     routes{txnManager: repo.TxnManager},
		repository: &repo,
		config:     cfg,
	}
	r.Route("/deovr", func(r chi.Router) {
		r.Get("/", vr.deovrHandler)
	})

	// Local HTTPS control — auto self-signed cert on a second port so WebXR
	// works on the LAN without an external tunnel.
	r.Route("/tls", func(r chi.Router) {
		r.Get("/status", server.tlsStatusHandler)
		r.Post("/enable", server.tlsEnableHandler)
		r.Post("/disable", server.tlsDisableHandler)
		r.Get("/ca.crt", server.tlsCACertHandler)
	})

	// Debug endpoints for profiling and metrics
	// Enable via STASH_DEBUG=1 environment variable or debug config
	debugEnabled := os.Getenv("STASH_DEBUG") == "1"
	pprofEnabled := os.Getenv("STASH_PPROF") == "1"
	r.Mount("/debug", apiDebug.Handler(apiDebug.Config{
		Enabled:       debugEnabled,
		EnablePprof:   pprofEnabled,
		EnableMetrics: true, // Metrics always enabled when debug is enabled
	}))

	// Health check endpoint — returns DB connectivity, schema version, and uptime.
	// Useful for Docker HEALTHCHECK and monitoring systems.
	// This goes through authentication middleware, which is appropriate since
	// the /healthz heartbeat already exists for unauthenticated liveness probes.
	r.Get("/health", server.getHealthHandler())

	// Metrics endpoint — always available (behind auth middleware),
	// does not require STASH_DEBUG=1 unlike the /debug endpoints.
	r.Get("/api/metrics", server.getMetricsHandler())

	r.HandleFunc("/css", cssHandler(cfg))
	r.HandleFunc("/javascript", javascriptHandler(cfg))
	r.HandleFunc("/customlocales", customLocalesHandler(cfg))

	staticLoginUI := statigz.FileServer(ui.LoginUIBox.(fs.ReadDirFS))

	r.Get(loginEndpoint, handleLogin())
	r.Post(loginEndpoint, handleLoginPost())
	r.Get(logoutEndpoint, handleLogout())
	r.Get(loginLocaleEndpoint, handleLoginLocale(cfg))
	r.HandleFunc(loginEndpoint+"/*", func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = strings.TrimPrefix(r.URL.Path, loginEndpoint)
		w.Header().Set("Cache-Control", "no-cache")
		staticLoginUI.ServeHTTP(w, r)
	})

	// Serve static folders
	customServedFolders := cfg.GetCustomServedFolders()
	if customServedFolders != nil {
		r.Mount("/custom", getCustomRoutes(customServedFolders))
	}

	var uiFS fs.FS
	var staticUI *statigz.Server
	customUILocation := cfg.GetUILocation()
	if customUILocation != "" {
		logger.Debugf("Serving UI from %s", customUILocation)
		uiFS = osFS(customUILocation)
		staticUI = statigz.FileServer(uiFS.(fs.ReadDirFS))
	} else {
		logger.Debug("Serving embedded UI")
		uiFS = ui.UIBox
		staticUI = statigz.FileServer(ui.UIBox.(fs.ReadDirFS))
	}

	// handle favicon override
	r.HandleFunc("/favicon.ico", handleFavicon(staticUI))

	// Serve the web app
	r.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
		ext := path.Ext(r.URL.Path)

		if ext == ".html" || ext == "" {
			w.Header().Set("Content-Type", "text/html")
			setPageSecurityHeaders(w, r, pluginCache.ListPlugins())
		}

		if ext == "" || r.URL.Path == "/" || r.URL.Path == "/index.html" {
			themeColor := cfg.GetThemeColor()
			data, err := fs.ReadFile(uiFS, "index.html")
			if err != nil {
				logger.Errorf("unable to read index.html from configured UI source: %v", err)
				data, err = fs.ReadFile(ui.UIBox, "index.html")
				if err != nil {
					logger.Errorf("unable to read embedded index.html fallback: %v", err)
					http.Error(w, "UI index.html is missing", http.StatusInternalServerError)
					return
				}
				logger.Warn("falling back to embedded UI index.html")
			}
			indexHtml := string(data)

			prefix := getProxyPrefix(r)
			indexHtml = strings.ReplaceAll(indexHtml, "%COLOR%", themeColor)
			indexHtml = strings.Replace(indexHtml, `<base href="/"`, fmt.Sprintf(`<base href="%s/"`, prefix), 1)

			utils.ServeStaticContent(w, r, []byte(indexHtml))
		} else {
			isStatic, _ := path.Match("/assets/*", r.URL.Path)
			if isStatic {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}

			staticUI.ServeHTTP(w, r)
		}
	})

	logger.Infof("stash version: %s", build.VersionString())
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		printLatestVersion(ctx)
	}()

	return server, nil
}

func handleFavicon(staticUI *statigz.Server) func(w http.ResponseWriter, r *http.Request) {
	mgr := manager.GetInstance()
	cfg := mgr.Config

	// check if favicon.ico exists in the config directory
	// if so, use that
	// otherwise, use the embedded one
	iconPath := filepath.Join(cfg.GetConfigPath(), "favicon.ico")
	exists, _ := fsutil.FileExists(iconPath)

	if exists {
		logger.Debugf("Using custom favicon at %s", iconPath)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")

		if exists {
			http.ServeFile(w, r, iconPath)
		} else {
			staticUI.ServeHTTP(w, r)
		}
	}
}

// Start starts the server. It listens on the configured address and port.
// It calls ListenAndServeTLS if TLS is configured, otherwise it calls ListenAndServe.
// Calls to Start are blocked until the server is shutdown.
func (s *Server) Start() error {
	logger.Infof("stash is listening on " + s.Addr)
	logger.Infof("stash is running at " + s.displayAddress)

	if cfg := config.GetInstance(); cfg.GetTLSAutoEnabled() {
		if err := s.enableHTTPS(cfg.GetTLSAutoPort()); err != nil {
			logger.Errorf("could not start local HTTPS listener: %v", err)
		}
	}

	if s.TLSConfig != nil {
		return s.ListenAndServeTLS("", "")
	} else {
		return s.ListenAndServe()
	}
}

// Shutdown gracefully shuts down the server without interrupting any active connections.
func (s *Server) Shutdown() {
	s.disableHTTPS()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := s.Server.Shutdown(ctx)
	if err != nil {
		logger.Errorf("Error shutting down http server: %v", err)
	}
}

// ── Local HTTPS (second listener) ─────────────────────────────────────────────

// enableHTTPS starts (or restarts on a new port) the auto local-HTTPS listener,
// generating/renewing the self-signed cert as needed. It shares the main
// router, so the same app is served over HTTPS on a separate port.
func (s *Server) enableHTTPS(port int) error {
	s.httpsMu.Lock()
	defer s.httpsMu.Unlock()

	if s.httpsServer != nil {
		if s.httpsPort == port {
			return nil // already running on the requested port
		}
		s.shutdownHTTPSLocked()
	}

	cfg := config.GetInstance()
	serverCert, _, err := tlscert.EnsureCert(cfg.GetConfigPath())
	if err != nil {
		s.httpsErr = err.Error()
		return err
	}

	addr := cfg.GetHost() + ":" + strconv.Itoa(port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		s.httpsErr = err.Error()
		return err
	}

	hs := &http.Server{
		Addr:      addr,
		Handler:   s.Handler,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{serverCert}},
		// disable http/2 for the same hijack reasons as the main server
		TLSNextProto: make(map[string]func(*http.Server, *tls.Conn, http.Handler)),
	}

	s.httpsServer = hs
	s.httpsPort = port
	s.httpsErr = ""

	go func() {
		err := hs.ServeTLS(ln, "", "")
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Errorf("local HTTPS listener error: %v", err)
			s.httpsMu.Lock()
			if s.httpsServer == hs {
				s.httpsServer = nil
				s.httpsErr = err.Error()
			}
			s.httpsMu.Unlock()
		}
	}()

	for _, u := range s.httpsURLs() {
		logger.Infof("local HTTPS available at %s", u)
	}
	return nil
}

func (s *Server) disableHTTPS() {
	s.httpsMu.Lock()
	defer s.httpsMu.Unlock()
	s.shutdownHTTPSLocked()
}

// shutdownHTTPSLocked stops the HTTPS listener. Callers must hold httpsMu.
func (s *Server) shutdownHTTPSLocked() {
	hs := s.httpsServer
	s.httpsServer = nil
	if hs == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := hs.Shutdown(ctx); err != nil {
		logger.Errorf("Error shutting down local HTTPS server: %v", err)
	}
}

// httpsURLs returns the https://<ip>:<port> URLs the headset can use, one per
// non-loopback LAN address.
func (s *Server) httpsURLs() []string {
	port := strconv.Itoa(s.httpsPort)
	var urls []string
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		var ip net.IP
		switch v := a.(type) {
		case *net.IPNet:
			ip = v.IP
		case *net.IPAddr:
			ip = v.IP
		}
		if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			continue
		}
		host := ip.String()
		if ip.To4() == nil {
			host = "[" + host + "]" // bracket IPv6
		}
		urls = append(urls, "https://"+host+":"+port+"/")
	}
	return urls
}

func (s *Server) tlsStatus() map[string]interface{} {
	s.httpsMu.Lock()
	running := s.httpsServer != nil
	port := s.httpsPort
	errMsg := s.httpsErr
	urls := []string{}
	if running {
		urls = s.httpsURLs()
	}
	s.httpsMu.Unlock()

	cfg := config.GetInstance()
	if port == 0 {
		port = cfg.GetTLSAutoPort()
	}
	return map[string]interface{}{
		"enabled": cfg.GetTLSAutoEnabled(),
		"running": running,
		"port":    port,
		"urls":    urls,
		"error":   nullableString(errMsg),
	}
}

func nullableString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func (s *Server) tlsStatusHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.tlsStatus())
}

func (s *Server) tlsEnableHandler(w http.ResponseWriter, r *http.Request) {
	cfg := config.GetInstance()
	port := cfg.GetTLSAutoPort()
	if p := r.URL.Query().Get("port"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 && parsed <= 65535 {
			port = parsed
		} else {
			http.Error(w, "invalid port", http.StatusBadRequest)
			return
		}
	}

	if err := s.enableHTTPS(port); err != nil {
		writeJSON(w, s.tlsStatus())
		return
	}

	cfg.SetTLSAutoEnabled(true)
	cfg.SetTLSAutoPort(port)
	if err := cfg.Write(); err != nil {
		logger.Errorf("error saving local HTTPS config: %v", err)
	}

	writeJSON(w, s.tlsStatus())
}

func (s *Server) tlsDisableHandler(w http.ResponseWriter, r *http.Request) {
	s.disableHTTPS()

	cfg := config.GetInstance()
	cfg.SetTLSAutoEnabled(false)
	if err := cfg.Write(); err != nil {
		logger.Errorf("error saving local HTTPS config: %v", err)
	}

	writeJSON(w, s.tlsStatus())
}

// tlsCACertHandler serves the CA certificate (never the key) for installing on
// client devices such as the Quest.
func (s *Server) tlsCACertHandler(w http.ResponseWriter, r *http.Request) {
	cfg := config.GetInstance()
	caPath := tlscert.PathsIn(cfg.GetConfigPath()).CACert
	data, err := os.ReadFile(caPath)
	if err != nil {
		http.Error(w, "certificate not generated yet — enable Local HTTPS first", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", `attachment; filename="stash-https-ca.crt"`)
	utils.ServeStaticContent(w, r, data)
}

func (s *Server) getPerformerRoutes() chi.Router {
	repo := s.manager.Repository
	return performerRoutes{
		routes:          routes{txnManager: repo.TxnManager},
		performerFinder: repo.Performer,
		sfwConfig:       s.manager.Config,
	}.Routes()
}

func (s *Server) getSceneRoutes() chi.Router {
	repo := s.manager.Repository
	return sceneRoutes{
		routes:               routes{txnManager: repo.TxnManager},
		sceneFinder:          repo.Scene,
		fileGetter:           repo.File,
		captionFinder:        repo.File,
		sceneCaptionFinder:   repo.Scene,
		sceneFunscriptFinder: repo.Scene,
		sceneMarkerFinder:    repo.SceneMarker,
		tagFinder:            repo.Tag,
	}.Routes()
}

func (s *Server) getHandyRoutes() chi.Router {
	repo := s.manager.Repository
	return handyRoutes{
		routes:               routes{txnManager: repo.TxnManager},
		sceneFinder:          repo.Scene,
		sceneFunscriptFinder: repo.Scene,
	}.Routes()
}

func (s *Server) getGalleryRoutes() chi.Router {
	repo := s.manager.Repository
	return galleryRoutes{
		routes:        routes{txnManager: repo.TxnManager},
		imageFinder:   repo.Image,
		galleryFinder: repo.Gallery,
		fileGetter:    repo.File,
	}.Routes()
}

func (s *Server) getImageRoutes() chi.Router {
	repo := s.manager.Repository
	return imageRoutes{
		routes:      routes{txnManager: repo.TxnManager},
		imageFinder: repo.Image,
		fileGetter:  repo.File,
	}.Routes()
}

func (s *Server) getStudioRoutes() chi.Router {
	repo := s.manager.Repository
	return studioRoutes{
		routes:       routes{txnManager: repo.TxnManager},
		studioFinder: repo.Studio,
	}.Routes()
}

func (s *Server) getGroupRoutes() chi.Router {
	repo := s.manager.Repository
	return groupRoutes{
		routes:      routes{txnManager: repo.TxnManager},
		groupFinder: repo.Group,
	}.Routes()
}

func (s *Server) getTagRoutes() chi.Router {
	repo := s.manager.Repository
	return tagRoutes{
		routes:    routes{txnManager: repo.TxnManager},
		tagFinder: repo.Tag,
	}.Routes()
}

func (s *Server) getDownloadsRoutes() chi.Router {
	return downloadsRoutes{}.Routes()
}

// getFaptapRoutes serves the optional FapTap sidecar catalog (premium VR addon).
// The reader is lazy and re-checks the database file on each call, so the addon
// locks/unlocks live as the file is added or removed — no restart required.
func (s *Server) getFaptapRoutes() chi.Router {
	// Resolve the FapTap data dir lazily so a path change (plugin setting, or
	// dropping in the plugin folder + Reload Plugins) takes effect on the next
	// request with no restart. Resolution order:
	//  1. explicit dataPath / faptap_path setting;
	//  2. the FapTap plugin's own folder (the db + funscripts/ ship inside it —
	//     a self-contained drop-in);
	//  3. <plugins>/faptap-vr, then <config>/faptap as last-resort fallbacks.
	dir := func() string {
		cfg := config.GetInstance()
		if v := cfg.GetFaptapPath(); v != "" {
			return v
		}
		if p := s.manager.PluginCache.GetPlugin("faptap"); p != nil && p.ConfigPath != "" {
			return filepath.Dir(p.ConfigPath)
		}
		if pp := cfg.GetPluginsPath(); pp != "" {
			return filepath.Join(pp, "faptap-vr")
		}
		return filepath.Join(cfg.GetConfigPath(), "faptap")
	}
	return faptapRoutes{
		db:  faptap.New(dir),
		dir: dir,
	}.Routes()
}

// getPmvhavenRoutes serves the optional PMVHaven sidecar catalog (premium VR
// addon). Like FapTap the reader is lazy and re-checks the database on each call
// so the tab locks/unlocks live. PMVHaven ships no funscripts, so the routes
// also carry a Generator that synthesizes one on demand from each video's audio
// (ffmpeg → analyzer.py) and caches it under the data folder's funscripts/ dir.
func (s *Server) getPmvhavenRoutes() chi.Router {
	// Data dir resolution mirrors FapTap:
	//  1. explicit dataPath / pmvhaven_path setting;
	//  2. the PMVHaven plugin's own folder (db + analyzer.py + funscripts/ cache);
	//  3. <plugins>/pmvhaven, then <config>/pmvhaven fallbacks.
	dir := func() string {
		cfg := config.GetInstance()
		if v := cfg.GetPmvhavenPath(); v != "" {
			return v
		}
		if p := s.manager.PluginCache.GetPlugin("pmvhaven"); p != nil && p.ConfigPath != "" {
			return filepath.Dir(p.ConfigPath)
		}
		if pp := cfg.GetPluginsPath(); pp != "" {
			return filepath.Join(pp, "pmvhaven")
		}
		return filepath.Join(cfg.GetConfigPath(), "pmvhaven")
	}
	// pluginSetting reads a string setting from the "pmvhaven" plugin config.
	pluginSetting := func(key string) string {
		if pc := config.GetInstance().GetPluginConfiguration("pmvhaven"); pc != nil {
			if v, ok := pc[key].(string); ok {
				return v
			}
		}
		return ""
	}
	db := pmvhaven.New(dir)
	gen := pmvhaven.NewGenerator(
		db,
		dir,
		func() string { return config.GetInstance().GetFFMpegPath() },
		func() string { return pluginSetting("pythonPath") },
		func() string { return pluginSetting("analyzerPath") },
		func() string { return pluginSetting("smooth") },
	)
	return pmvhavenRoutes{db: db, gen: gen}.Routes()
}

func (s *Server) getPluginRoutes() chi.Router {
	return pluginRoutes{
		pluginCache: s.manager.PluginCache,
	}.Routes()
}

func (s *Server) getScheduledTaskRoutes() chi.Router {
	return scheduledTaskRoutes{}.Routes()
}

func (s *Server) getProxyRoutes() chi.Router {
	repo := s.manager.Repository
	return proxyRoutes{
		routes: routes{txnManager: repo.TxnManager},
	}.Routes()
}

func (s *Server) getStashFaceRoutes() chi.Router {
	return stashFaceRoutes{
		routes:      routes{txnManager: s.manager.Repository.TxnManager},
		controller:  s.stashFaceController,
		sceneFinder: s.manager.Repository.Scene,
	}.Routes()
}

func (s *Server) getStashTagRoutes() chi.Router {
	return stashTagRoutes{
		routes:     routes{txnManager: s.manager.Repository.TxnManager},
		controller: s.stashTagController,
	}.Routes()
}

func (s *Server) getMegaFaceRoutes() chi.Router {
	return megaFaceRoutes{
		routes:     routes{txnManager: s.manager.Repository.TxnManager},
		controller: s.megaFaceController,
	}.Routes()
}

func (s *Server) getHealthHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		version, _, _ := build.Version()

		health := map[string]interface{}{
			"status":  "ok",
			"version": version,
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		metrics.WriteJSONResponse(w, health)
	}
}

func (s *Server) getMetricsHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		metrics.WriteJSONResponse(w, metrics.Snapshot())
	}
}

func copyFile(w io.Writer, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(w, f)

	return err
}

func serveFiles(w http.ResponseWriter, r *http.Request, paths []string) {
	buffer := bytes.Buffer{}

	for _, path := range paths {
		err := copyFile(&buffer, path)
		if err != nil {
			logger.Errorf("error serving file %s: %v", path, err)
		}
		buffer.Write([]byte("\n"))
	}

	utils.ServeStaticContent(w, r, buffer.Bytes())
}

func cssHandler(c *config.Config) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		var paths []string

		if c.GetCSSEnabled() {
			// search for custom.css in current directory, then $HOME/.stash
			fn := c.GetCSSPath()
			exists, _ := fsutil.FileExists(fn)
			if exists {
				paths = append(paths, fn)
			}
		}

		w.Header().Set("Content-Type", "text/css")
		serveFiles(w, r, paths)
	}
}

func javascriptHandler(c *config.Config) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		var paths []string

		if c.GetJavascriptEnabled() {
			// search for custom.js in current directory, then $HOME/.stash
			fn := c.GetJavascriptPath()
			exists, _ := fsutil.FileExists(fn)
			if exists {
				paths = append(paths, fn)
			}
		}

		w.Header().Set("Content-Type", "text/javascript")
		serveFiles(w, r, paths)
	}
}

func customLocalesHandler(c *config.Config) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		buffer := bytes.Buffer{}

		if c.GetCustomLocalesEnabled() {
			// search for custom-locales.json in current directory, then $HOME/.stash
			path := c.GetCustomLocalesPath()
			exists, _ := fsutil.FileExists(path)
			if exists {
				err := copyFile(&buffer, path)
				if err != nil {
					logger.Errorf("error serving file %s: %v", path, err)
				}
			}
		}

		if buffer.Len() == 0 {
			buffer.Write([]byte("{}"))
		}

		w.Header().Set("Content-Type", "application/json")
		utils.ServeStaticContent(w, r, buffer.Bytes())
	}
}

func makeTLSConfig(c *config.Config) (*tls.Config, error) {
	c.InitTLS()
	certFile, keyFile := c.GetTLSFiles()

	if certFile == "" && keyFile == "" {
		// assume http configuration
		return nil, nil
	}

	// ensure both files are present
	if certFile == "" {
		return nil, errors.New("SSL certificate file must be present if key file is present")
	}

	if keyFile == "" {
		return nil, errors.New("SSL key file must be present if certificate file is present")
	}

	cert, err := os.ReadFile(certFile)
	if err != nil {
		return nil, fmt.Errorf("error reading SSL certificate file %s: %v", certFile, err)
	}

	key, err := os.ReadFile(keyFile)
	if err != nil {
		return nil, fmt.Errorf("error reading SSL key file %s: %v", keyFile, err)
	}

	certs := make([]tls.Certificate, 1)
	certs[0], err = tls.X509KeyPair(cert, key)
	if err != nil {
		return nil, fmt.Errorf("error parsing key pair: %v", err)
	}
	tlsConfig := &tls.Config{
		Certificates: certs,
	}

	return tlsConfig, nil
}

func isURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

func setPageSecurityHeaders(w http.ResponseWriter, r *http.Request, plugins []*plugin.Plugin) {
	c := config.GetInstance()

	defaultSrc := "data: 'self' 'unsafe-inline'"
	connectSrcSlice := []string{
		"data:",
		"'self'",
	}
	imageSrc := "data: *"
	scriptSrcSlice := []string{
		"'self'",
		"http://www.gstatic.com",
		"https://www.gstatic.com",
		"https://cdn.jsdelivr.net", // HLS.js for trailer player
		"'unsafe-inline'",
		"'unsafe-eval'",
	}
	styleSrcSlice := []string{
		"'self'",
		"'unsafe-inline'",
	}
	mediaSrc := "blob: 'self' https: https://*.project1content.com https://*.project1service.com https://*.algolia.net https://*.adulttime.com https://*.adulttimecdn.com https://*.gammacdn.com"

	// Workaround Safari bug https://bugs.webkit.org/show_bug.cgi?id=201591
	// Allows websocket requests to any origin
	// Also allow https: for HLS segment fetching
	connectSrcSlice = append(connectSrcSlice, "ws:", "wss:", "https:")

	// The graphql playground pulls its frontend from a cdn
	if r.URL.Path == playgroundEndpoint {
		connectSrcSlice = append(connectSrcSlice, "https://cdn.jsdelivr.net")
		scriptSrcSlice = append(scriptSrcSlice, "https://cdn.jsdelivr.net")
		styleSrcSlice = append(styleSrcSlice, "https://cdn.jsdelivr.net")
	}

	if !c.IsNewSystem() && c.GetHandyKey() != "" {
		connectSrcSlice = append(connectSrcSlice, "https://www.handyfeeling.com")
	}

	for _, plugin := range plugins {
		if !plugin.Enabled {
			continue
		}

		ui := plugin.UI

		for _, url := range ui.ExternalScript {
			if isURL(url) {
				scriptSrcSlice = append(scriptSrcSlice, url)
			}
		}

		for _, url := range ui.ExternalCSS {
			if isURL(url) {
				styleSrcSlice = append(styleSrcSlice, url)
			}
		}

		connectSrcSlice = append(connectSrcSlice, ui.CSP.ConnectSrc...)
		scriptSrcSlice = append(scriptSrcSlice, ui.CSP.ScriptSrc...)
		styleSrcSlice = append(styleSrcSlice, ui.CSP.StyleSrc...)
	}

	connectSrc := strings.Join(connectSrcSlice, " ")
	scriptSrc := strings.Join(scriptSrcSlice, " ")
	styleSrc := strings.Join(styleSrcSlice, " ")

	cspDirectives := fmt.Sprintf("default-src %s; connect-src %s; img-src %s; script-src %s; style-src %s; media-src %s;", defaultSrc, connectSrc, imageSrc, scriptSrc, styleSrc, mediaSrc)
	cspDirectives += " worker-src blob:; child-src 'none'; object-src 'none'; form-action 'self';"

	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("Content-Security-Policy", cspDirectives)
}

func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")

		next.ServeHTTP(w, r)
	}
	return http.HandlerFunc(fn)
}

// mediaAwareCompress wraps chi's middleware.Compress but bypasses gzip for
// video/audio streaming routes.  DeoVR (and most video players) rely on
// HTTP Range requests with byte-accurate Content-Range headers.  Gzip
// compression re-encodes the response body, which makes Content-Range
// offsets meaningless and corrupts the byte stream the player expects —
// causing "Unsupported Format" errors.
func mediaAwareCompress(level int) func(http.Handler) http.Handler {
	compressor := middleware.Compress(level)

	return func(next http.Handler) http.Handler {
		compressed := compressor(next) // pre-build the compressed handler

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := r.URL.Path

			// Skip compression for all scene streaming and media endpoints.
			// These serve large binary content via http.ServeFile which
			// already handles Range requests correctly — gzip would break them.
			if strings.HasPrefix(p, "/scene/") &&
				(strings.Contains(p, "/stream") ||
					strings.Contains(p, "/preview") ||
					strings.Contains(p, "/funscript") ||
					strings.Contains(p, "/interactive_csv")) {
				next.ServeHTTP(w, r)
				return
			}

			// WebSocket upgrades need http.Hijacker, which the gzip writer
			// does not implement — bypass compression for the Handy WS.
			if strings.HasPrefix(p, "/handy/") {
				next.ServeHTTP(w, r)
				return
			}

			// Also skip if the client is requesting a specific byte range —
			// this catches any Range request regardless of path.
			if r.Header.Get("Range") != "" {
				next.ServeHTTP(w, r)
				return
			}

			compressed.ServeHTTP(w, r)
		})
	}
}

type contextKey struct {
	name string
}

var (
	BaseURLCtxKey = &contextKey{"BaseURL"}
)

func BaseURLMiddleware(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		scheme := "http"
		if strings.Compare("https", r.URL.Scheme) == 0 || r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		prefix := getProxyPrefix(r)

		baseURL := scheme + "://" + r.Host + prefix

		externalHost := config.GetInstance().GetExternalHost()
		if externalHost != "" {
			baseURL = externalHost + prefix
		}

		r = r.WithContext(context.WithValue(ctx, BaseURLCtxKey, baseURL))

		next.ServeHTTP(w, r)
	}
	return http.HandlerFunc(fn)
}

func getProxyPrefix(r *http.Request) string {
	return strings.TrimRight(r.Header.Get("X-Forwarded-Prefix"), "/")
}
