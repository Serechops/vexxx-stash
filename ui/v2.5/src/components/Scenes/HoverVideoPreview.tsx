import React, { useEffect, useRef } from "react";
import cx from "classnames";
import { Box } from "@mui/material";
import { PreviewScrubber } from "./PreviewScrubber";
import * as GQL from "src/core/generated-graphql";

interface IHoverVideoPreviewProps {
    image?: string;
    video?: string;
    isHovered: boolean;
    soundActive: boolean;
    isPortrait?: boolean;
    vttPath?: string;
    vrMode?: GQL.VrMode | null;
    onScrubberClick?: (timestamp: number) => void;
}

function vrTransformStyle(vrMode?: GQL.VrMode | null): React.CSSProperties {
    switch (vrMode) {
        case GQL.VrMode.Lr180:
            return { transform: "scaleX(2)", transformOrigin: "left center" };
        case GQL.VrMode.Tb360:
            return { transform: "scaleY(2)", transformOrigin: "center top" };
        default:
            return {};
    }
}

export const HoverVideoPreview: React.FC<IHoverVideoPreviewProps> = ({
    image,
    video,
    isHovered,
    soundActive,
    isPortrait = false,
    vttPath,
    vrMode,
    onScrubberClick,
}) => {
    const vrStyle = vrTransformStyle(vrMode);
    const videoEl = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (!videoEl.current) return;

        if (isHovered) {
            const playPromise = videoEl.current.play();
            if (playPromise !== undefined) {
                playPromise.catch((_error) => {
                    // Auto-play was prevented
                });
            }
        } else {
            videoEl.current.pause();
            videoEl.current.currentTime = 0;
        }
    }, [isHovered]);

    useEffect(() => {
        if (videoEl?.current) {
            videoEl.current.volume = soundActive ? 0.05 : 0;
            videoEl.current.muted = !soundActive;
        }
    }, [soundActive]);

    return (
        <Box
            sx={{
                position: "relative",
                width: "100%",
                aspectRatio: "16 / 9",
                overflow: "hidden",
                backgroundColor: "#000",
                display: "flex",
                justifyContent: "center",
                ...(isPortrait && {
                    "& .scene-card-preview-image, & .scene-card-preview-video": {
                        objectFit: "contain",
                    },
                }),
            }}
        >
            <Box
                component="img"
                className={cx("scene-card-preview-image", { hidden: isHovered && video })}
                loading="lazy"
                src={image}
                alt=""
                sx={{
                    height: "100%",
                    width: "100%",
                    objectFit: "cover",
                    objectPosition: "top",
                    transition: "opacity 0.2s",
                    "&.hidden": { opacity: 0 },
                    ...vrStyle,
                }}
            />
            <Box
                component="video"
                disableRemotePlayback
                playsInline
                muted={!soundActive}
                className={cx("scene-card-preview-video", { hidden: !isHovered })}
                loop
                preload="none"
                ref={videoEl}
                src={video}
                sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    height: "100%",
                    width: "100%",
                    objectFit: "cover",
                    objectPosition: "top",
                    opacity: 0,
                    transition: "opacity 0.2s",
                    "&.hidden": { display: "none" },
                    ...(isHovered && { opacity: 1 }),
                    ...vrStyle,
                }}
            />
            {/* Show scrubber when video is playing/hovered */}
            {isHovered && vttPath && <PreviewScrubber vttPath={vttPath} onClick={onScrubberClick} />}
        </Box>
    );
};
