package api

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"github.com/stashapp/stash/pkg/file/video"
	"github.com/stashapp/stash/pkg/handy"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/txn"
)

// handyRoutes serves the local (BLE) Handy control WebSocket. The browser
// sends small JSON ops; the backend owns the Bluetooth connection and the
// HSP script feeding, so no funscript data or timing-sensitive traffic ever
// leaves the LAN — and no Handy cloud API is involved.
type handyRoutes struct {
	routes
	sceneFinder          SceneFinder
	sceneFunscriptFinder SceneFunscriptFinder
}

func (rs handyRoutes) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/ws", rs.WebSocket)
	return r
}

var handyUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	// Auth already ran in the middleware chain; same-origin enforcement is
	// not useful for a LAN app served from varying hosts/IPs.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// handyOp is a client → server operation.
type handyOp struct {
	Op             string  `json:"op"`
	Seq            int64   `json:"seq"`
	SceneID        int     `json:"sceneId,omitempty"`
	FunscriptIndex *int    `json:"funscriptIndex,omitempty"`
	Position       int32   `json:"position,omitempty"` // ms
	Rate           float32 `json:"rate,omitempty"`
	Loop           bool    `json:"loop,omitempty"`
	Min            float32 `json:"min,omitempty"`
	Max            float32 `json:"max,omitempty"`
	Velocity       float32 `json:"velocity,omitempty"`
	Amplitude      float32 `json:"amplitude,omitempty"`
	Frequency      uint32  `json:"frequency,omitempty"`
}

type handyReply struct {
	Type    string `json:"type"` // "ack" | "error"
	Seq     int64  `json:"seq"`
	Message string `json:"message,omitempty"`
}

type handyStatusMsg struct {
	Type string `json:"type"` // "status"
	handy.EngineStatus
}

func (rs handyRoutes) WebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := handyUpgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Warnf("[handy] websocket upgrade failed: %v", err)
		return
	}

	mgr := handy.GetManager()
	outbound := make(chan interface{}, 32)
	done := make(chan struct{})

	statusCh, unsubscribe := mgr.Subscribe()
	defer unsubscribe()

	// single writer goroutine (gorilla allows one concurrent writer)
	go func() {
		for {
			select {
			case msg := <-outbound:
				if err := conn.WriteJSON(msg); err != nil {
					return
				}
			case st := <-statusCh:
				if err := conn.WriteJSON(handyStatusMsg{Type: "status", EngineStatus: st}); err != nil {
					return
				}
			case <-done:
				return
			}
		}
	}()

	// initial status snapshot
	outbound <- handyStatusMsg{Type: "status", EngineStatus: mgr.Engine().Status()}

	defer close(done)
	defer conn.Close()

	for {
		var op handyOp
		if err := conn.ReadJSON(&op); err != nil {
			return
		}
		// Ops run concurrently; the client serializes via per-seq acks where
		// ordering matters. This keeps the read loop free for emergency stop.
		go func(op handyOp) {
			if err := rs.execute(r.Context(), mgr, op); err != nil {
				logger.Warnf("[handy] op %q failed: %v", op.Op, err)
				select {
				case outbound <- handyReply{Type: "error", Seq: op.Seq, Message: err.Error()}:
				case <-done:
				}
				return
			}
			select {
			case outbound <- handyReply{Type: "ack", Seq: op.Seq}:
			case <-done:
			}
		}(op)
	}
}

func (rs handyRoutes) execute(ctx context.Context, mgr *handy.Manager, op handyOp) error {
	eng := mgr.Engine()
	switch op.Op {
	case "connect":
		return mgr.Connect(ctx)
	case "disconnect":
		mgr.Disconnect()
		return nil
	case "load":
		points, err := rs.loadScenePoints(ctx, op.SceneID, op.FunscriptIndex)
		if err != nil {
			return err
		}
		return eng.LoadScript(ctx, points)
	case "play":
		return eng.Play(ctx, op.Position, op.Rate, op.Loop)
	case "pause":
		return eng.Pause(ctx)
	case "stop":
		return eng.Stop(ctx)
	case "sync":
		return eng.SyncTime(ctx, op.Position)
	case "rate":
		return eng.SetRate(ctx, op.Rate)
	case "loop":
		return eng.SetLoop(ctx, op.Loop)
	case "stroke":
		return eng.SetStroke(ctx, op.Min, op.Max)
	case "hdsp":
		return eng.HdspPosition(ctx, op.Position0to100(), op.Velocity)
	case "hampStart":
		return eng.HampStart(ctx)
	case "hampStop":
		return eng.HampStop(ctx)
	case "hampVelocity":
		return eng.HampVelocity(ctx, op.Velocity)
	case "hvpStart":
		return eng.HvpStart(ctx)
	case "hvpStop":
		return eng.HvpStop(ctx)
	case "hvp":
		return eng.HvpState(ctx, op.Amplitude, op.Frequency, op.Position0to100())
	case "estop":
		return eng.EmergencyStop(ctx)
	case "status":
		return nil // ack triggers nothing; status flows via subscription
	default:
		return errUnknownHandyOp(op.Op)
	}
}

// Position0to100 reinterprets the ms-typed Position field for ops that carry
// a 0–100 position instead (hdsp, hvp).
func (op handyOp) Position0to100() float32 {
	return float32(op.Position)
}

type errUnknownHandyOp string

func (e errUnknownHandyOp) Error() string { return "unknown op: " + string(e) }

// loadScenePoints resolves the active (or index-selected) funscript for a
// scene — same rules as /scene/{id}/funscript — and parses it into HSP points.
func (rs handyRoutes) loadScenePoints(ctx context.Context, sceneID int, funscriptIndex *int) ([]handy.Point, error) {
	if sceneID <= 0 {
		return nil, errUnknownHandyOp("load requires sceneId")
	}
	var filepath string
	if err := txn.WithReadTxn(ctx, rs.txnManager, func(ctx context.Context) error {
		scene, err := rs.sceneFinder.Find(ctx, sceneID)
		if err != nil {
			return err
		}
		if scene == nil {
			return &notFoundError{"scene " + strconv.Itoa(sceneID)}
		}
		filepath = video.GetFunscriptPath(scene.Path)
		if scene.FunscriptPath != nil {
			filepath = *scene.FunscriptPath
		}
		if funscriptIndex != nil && *funscriptIndex >= 0 && rs.sceneFunscriptFinder != nil {
			list, lerr := rs.sceneFunscriptFinder.GetSceneFunscripts(ctx, sceneID)
			if lerr == nil && *funscriptIndex < len(list) {
				filepath = list[*funscriptIndex].Path
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return handy.LoadFunscriptPoints(filepath)
}

type notFoundError struct{ what string }

func (e *notFoundError) Error() string { return e.what + " not found" }
