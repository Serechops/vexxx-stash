/**
 * EnterVRHomeButton — global navbar entry into the immersive "VR Home".
 *
 * Unlike [EnterVRButton] (which launches one scene from its detail page), this
 * drops the headset straight into the spatial Home wall, where the whole VR
 * library is browsed and launched without leaving the session. Shown only when
 * the browser reports `immersive-vr` support (Quest / tethered PCVR), so it is
 * invisible on desktops. three.js stays in the lazy [ImmersiveVRPlayer] chunk.
 *
 * The immersive overlay is portalled to <body> (position: fixed) so it escapes
 * the navbar's stacking context and covers the whole viewport.
 */
import React, { Suspense, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { IconButton, Tooltip } from "@mui/material";
import Vrpano from "@mui/icons-material/Vrpano";

const ImmersiveVRPlayer = React.lazy(() => import("./ImmersiveVRPlayer"));

const SESSION_INIT: XRSessionInit = {
  optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
};

export const EnterVRHomeButton: React.FC = () => {
  const [supported, setSupported] = useState(false);
  const [session, setSession] = useState<XRSession | null>(null);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);

  useEffect(() => {
    let active = true;
    const { xr } = navigator;
    if (!xr?.isSessionSupported) {
      setSupported(false);
      return;
    }
    xr.isSessionSupported("immersive-vr")
      .then((ok) => {
        if (!active) return;
        setSupported(ok);
        // Warm the lazy chunk so entry is instant.
        if (ok) import("./ImmersiveVRPlayer").catch(() => undefined);
      })
      .catch(() => active && setSupported(false));
    return () => {
      active = false;
    };
  }, []);

  const launch = async () => {
    if (launchingRef.current || session) return;
    const { xr } = navigator;
    if (!xr) return;
    launchingRef.current = true;
    setLaunching(true);
    try {
      const xrSession = await xr.requestSession("immersive-vr", SESSION_INIT);
      setSession(xrSession);
    } catch {
      // user cancelled or runtime refused — silently reset
    } finally {
      launchingRef.current = false;
      setLaunching(false);
    }
  };

  const handleExit = () => setSession(null);

  if (!supported) return null;

  return (
    <>
      <Tooltip title="Enter VR — browse your library in the headset">
        <span>
          <IconButton
            aria-label="Enter VR Home"
            disabled={launching}
            onClick={launch}
            size="small"
            sx={{ color: "inherit" }}
          >
            <Vrpano fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      {session &&
        ReactDOM.createPortal(
          <div style={{ position: "fixed", inset: 0, zIndex: 2000 }}>
            <Suspense fallback={null}>
              <ImmersiveVRPlayer
                scene={null}
                session={session}
                onExit={handleExit}
              />
            </Suspense>
          </div>,
          document.body
        )}
    </>
  );
};

export default EnterVRHomeButton;
