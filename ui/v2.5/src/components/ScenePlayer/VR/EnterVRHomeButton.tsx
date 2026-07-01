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
 *
 * `prominent` renders a full-width labeled Button for the mobile drawer footer.
 */
import React, { Suspense, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { IconButton, Tooltip, Button } from "@mui/material";
import { immersiveSupported, requestImmersiveSession } from "./passthrough";

const ImmersiveVRPlayer = React.lazy(() => import("./ImmersiveVRPlayer"));

export const EnterVRHomeButton: React.FC<{ prominent?: boolean }> = ({ prominent }) => {
  const [supported, setSupported] = useState(false);
  const [session, setSession] = useState<XRSession | null>(null);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);

  useEffect(() => {
    let active = true;
    immersiveSupported(navigator.xr)
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
      // AR-first (enables the passthrough toggles), immersive-vr fallback.
      const xrSession = await requestImmersiveSession(xr);
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

  const portal = session
    ? ReactDOM.createPortal(
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
      )
    : null;

  const vrIcon = (
    <img src="/vr.svg" alt="VR" style={{ width: 22, height: 18 }} />
  );

  if (prominent) {
    return (
      <>
        <Button
          variant="contained"
          fullWidth
          startIcon={vrIcon}
          disabled={launching}
          onClick={launch}
          sx={{
            background: "linear-gradient(135deg, #6366f1 0%, #9333ea 100%)",
            borderRadius: 2,
            py: 1.25,
            fontWeight: 600,
            mb: 1,
            textTransform: "none",
            "&:hover": {
              background: "linear-gradient(135deg, #818cf8 0%, #a855f7 100%)",
            },
          }}
        >
          Enter VR Home
        </Button>
        {portal}
      </>
    );
  }

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
            {vrIcon}
          </IconButton>
        </span>
      </Tooltip>
      {portal}
    </>
  );
};

export default EnterVRHomeButton;
