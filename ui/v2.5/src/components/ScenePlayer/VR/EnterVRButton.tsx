/**
 * EnterVRButton — overlay launch control for the immersive WebXR player.
 *
 * Shows only when the browser reports `immersive-vr` support (so it's hidden on
 * desktops without a headset, visible on Quest and tethered PCVR). Requests the
 * XR session inside the click gesture, then lazy-loads [ImmersiveVRPlayer] —
 * keeping three.js out of the main bundle until VR is actually entered.
 */
import React, { Suspense, useEffect, useRef, useState } from "react";
import { Box, Tooltip } from "@mui/material";
import Vrpano from "@mui/icons-material/Vrpano";
import * as GQL from "src/core/generated-graphql";
import { useConfigurationContext } from "src/hooks/Config";
import "./styles.scss";

const ImmersiveVRPlayer = React.lazy(() => import("./ImmersiveVRPlayer"));

const SESSION_INIT: XRSessionInit = {
  optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
};

function isQuestBrowser(): boolean {
  return /oculusbrowser|quest/i.test(navigator.userAgent);
}

export interface IEnterVRButtonProps {
  scene: GQL.SceneDataFragment;
  onNext?: () => void;
  onPrevious?: () => void;
}

export const EnterVRButton: React.FC<IEnterVRButtonProps> = ({
  scene,
  onNext,
  onPrevious,
}) => {
  const { configuration } = useConfigurationContext();
  const vrTag = configuration?.ui?.vrTag ?? undefined;

  const [supported, setSupported] = useState(false);
  const [session, setSession] = useState<XRSession | null>(null);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);

  // Prominent when the scene is known/likely VR.
  const isVrScene =
    !!scene.vr_mode ||
    (!!vrTag && scene.tags.some((t) => t.name === vrTag)) ||
    isQuestBrowser();

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

  const handleExit = () => {
    setSession(null);
  };

  if (!supported) return null;

  return (
    <>
      <Tooltip title="Watch in VR headset" placement="left">
        <Box
          component="button"
          type="button"
          aria-label="Enter VR"
          className={isVrScene ? "vr-enter-button is-vr" : "vr-enter-button"}
          disabled={launching}
          onClick={launch}
          sx={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            px: 1.5,
            py: 1,
            border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: "8px",
            color: "white",
            bgcolor: "rgba(0,0,0,0.55)",
            cursor: "pointer",
            backdropFilter: "blur(4px)",
            fontSize: "0.85rem",
            fontWeight: 600,
            "&:hover": { bgcolor: "rgba(0,0,0,0.75)" },
            "&:disabled": { opacity: 0.6, cursor: "default" },
          }}
        >
          <Vrpano fontSize="small" />
          VR
        </Box>
      </Tooltip>

      {session && (
        <Suspense fallback={null}>
          <ImmersiveVRPlayer
            scene={scene}
            session={session}
            onExit={handleExit}
            onNext={onNext}
            onPrevious={onPrevious}
          />
        </Suspense>
      )}
    </>
  );
};

export default EnterVRButton;
