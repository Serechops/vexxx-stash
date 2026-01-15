import React, {
  useRef,
  useMemo,
  useState,
  useLayoutEffect,
  useEffect,
} from "react";
import { useSpriteInfo } from "src/hooks/sprite";
import { useThrottle } from "src/hooks/throttle";
import TextUtils from "src/utils/text";
import { HoverScrubber } from "../Shared/HoverScrubber";
import { Box } from "@mui/material";

interface IScenePreviewProps {
  vttPath: string | undefined;
  onClick?: (timestamp: number) => void;
}

function scaleToFit(dimensions: { w: number; h: number }, bounds: DOMRect) {
  const rw = bounds.width / dimensions.w;
  const rh = bounds.height / dimensions.h;

  // for consistency, use max by default and min for portrait
  if (dimensions.w > dimensions.h) {
    return Math.max(rw, rh);
  }

  return Math.min(rw, rh);
}

const defaultSprites = 81; // 9x9 grid by default

export const PreviewScrubber: React.FC<IScenePreviewProps> = ({
  vttPath,
  onClick,
}) => {
  const imageParentRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const [activeIndex, setActiveIndex] = useState<number>();

  const debounceSetActiveIndex = useThrottle(setActiveIndex, 50);

  // hold off on loading vtt until first mouse over
  const [hasLoaded, setHasLoaded] = useState(false);
  const spriteInfo = useSpriteInfo(hasLoaded ? vttPath : undefined);

  const sprite = useMemo(() => {
    if (!spriteInfo || activeIndex === undefined) {
      return undefined;
    }
    return spriteInfo[activeIndex];
  }, [activeIndex, spriteInfo]);

  // mark as loaded on the first hover
  useEffect(() => {
    if (activeIndex !== undefined) {
      setHasLoaded(true);
    }
  }, [activeIndex]);

  useLayoutEffect(() => {
    const imageParent = imageParentRef.current;

    if (!sprite || !imageParent) {
      return setStyle({});
    }

    const clientRect = imageParent.getBoundingClientRect();
    const scale = scaleToFit(sprite, clientRect);

    setStyle({
      backgroundPosition: `${-sprite.x}px ${-sprite.y}px`,
      backgroundImage: `url(${sprite.url})`,
      width: `${sprite.w}px`,
      height: `${sprite.h}px`,
      transform: `scale(${scale})`,
    });
  }, [sprite]);

  const currentTime = useMemo(() => {
    if (!sprite) return undefined;

    const start = TextUtils.secondsToTimestamp(sprite.start);

    return start;
  }, [sprite]);

  function onScrubberClick(index: number) {
    if (!onClick || !spriteInfo) {
      return;
    }

    const s = spriteInfo[index];
    onClick(s.start);
  }

  if (spriteInfo === null || !vttPath) return null;

  return (
    <Box
      className="preview-scrubber"
      sx={{
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        zIndex: 10,
      }}
    >
      {sprite && (
        <Box
          className="scene-card-preview-image"
          ref={imageParentRef}
          sx={{
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <Box className="scrubber-image" sx={{ height: "100%", width: "100%", ...style }} />
          {currentTime !== undefined && (
            <Box
              className="scrubber-timestamp"
              sx={{
                bottom: "calc(20px + 0.25rem)",
                fontWeight: 400,
                opacity: 0.75,
                position: "absolute",
                right: "0.7rem",
                textShadow: "0 0 3px #000",
                color: "#fff",
                fontSize: "0.75rem",
              }}
            >
              {currentTime}
            </Box>
          )}
        </Box>
      )}
      <HoverScrubber
        totalSprites={spriteInfo?.length ?? defaultSprites}
        activeIndex={activeIndex}
        setActiveIndex={(i) => debounceSetActiveIndex(i)}
        onClick={onScrubberClick}
      />
    </Box>
  );
};
