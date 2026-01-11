import React, { useEffect, useRef } from "react";
import cx from "classnames";
import { PreviewScrubber } from "./PreviewScrubber";

interface IHoverVideoPreviewProps {
    image?: string;
    video?: string;
    isHovered: boolean;
    soundActive: boolean;
    isPortrait?: boolean;
    vttPath?: string;
    onScrubberClick?: (timestamp: number) => void;
}

export const HoverVideoPreview: React.FC<IHoverVideoPreviewProps> = ({
    image,
    video,
    isHovered,
    soundActive,
    isPortrait = false,
    vttPath,
    onScrubberClick,
}) => {
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
        <div className={cx("scene-card-preview", { portrait: isPortrait })}>
            <img
                className={cx("scene-card-preview-image", { hidden: isHovered && video })}
                loading="lazy"
                src={image}
                alt=""
            />
            <video
                disableRemotePlayback
                playsInline
                muted={!soundActive}
                className={cx("scene-card-preview-video", { hidden: !isHovered })}
                loop
                preload="none"
                ref={videoEl}
                src={video}
            />
            {/* Show scrubber when video is playing/hovered */}
            {isHovered && vttPath && <PreviewScrubber vttPath={vttPath} onClick={onScrubberClick} />}
        </div>
    );
};
