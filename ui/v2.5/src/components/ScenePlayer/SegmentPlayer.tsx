import React, { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "react-bootstrap";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "src/components/Shared/Icon";
import {
    faPlay,
    faPause,
    faVolumeUp,
    faVolumeMute,
    faExpand,
    faCompress,
} from "@fortawesome/free-solid-svg-icons";
import TextUtils from "src/utils/text";
import { ScenePlayerScrubber } from "./ScenePlayerScrubber";
import "./styles.scss";

interface ISegmentPlayerProps {
    scene: GQL.SceneDataFragment;
}

export const SegmentPlayer: React.FC<ISegmentPlayerProps> = ({ scene }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);

    // Segment bounds
    const startPoint = scene.start_point ?? 0;
    const file = scene.files[0];
    const endPoint = scene.end_point && scene.end_point > 0 ? scene.end_point : (file?.duration ?? 0);

    const duration = endPoint - startPoint;

    const togglePlay = useCallback(() => {
        if (videoRef.current) {
            if (videoRef.current.paused) {
                videoRef.current.play();
            } else {
                videoRef.current.pause();
            }
        }
    }, []);

    const handleTimeUpdate = useCallback(() => {
        if (videoRef.current) {
            const current = videoRef.current.currentTime;
            setCurrentTime(current);

            // Segment Loop enforcement
            if (current >= endPoint) {
                videoRef.current.currentTime = startPoint;
                if (!videoRef.current.paused) videoRef.current.play();
            }
        }
    }, [endPoint, startPoint]);

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = Number(e.target.value);
        if (videoRef.current) {
            videoRef.current.volume = newVolume;
        }
        setVolume(newVolume);
        setMuted(newVolume === 0);
    };

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !muted;
            setMuted(!muted);
        }
    };

    const pausedBeforeScrub = useRef(false);
    const onScrubberScroll = useCallback(() => {
        if (videoRef.current && !videoRef.current.paused) {
            pausedBeforeScrub.current = false;
            videoRef.current.pause();
        } else {
            pausedBeforeScrub.current = true;
        }
    }, []);

    const onScrubberSeek = useCallback((seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = seconds;
            if (!pausedBeforeScrub.current) {
                videoRef.current.play();
            }
        }
    }, []);

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            videoRef.current?.parentElement?.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    useEffect(() => {
        const onFSChange = () => setFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFSChange);
        return () => document.removeEventListener("fullscreenchange", onFSChange);
    }, []);

    // Initial setup: start at startPoint
    useEffect(() => {
        if (videoRef.current) {
            if (videoRef.current.currentTime === 0) {
                videoRef.current.currentTime = startPoint;
            }
        }
    }, [startPoint]);

    // Determine the best stream source compatible with simple video tag
    const streamUrl = React.useMemo(() => {
        if (!scene.sceneStreams || scene.sceneStreams.length === 0) {
            return `/scene/${scene.id}/stream`;
        }

        // Prefer MP4/WebM
        const compatibleStream = scene.sceneStreams.find(
            (s) =>
                s.mime_type?.includes("video/mp4") || s.mime_type?.includes("video/webm")
        );

        if (compatibleStream) return compatibleStream.url;

        // Fallback to the first stream if no specific compatible one found (e.g. direct stream)
        return scene.sceneStreams[0].url;
    }, [scene]);

    return (
        <div className={`segment-player-container VideoPlayer ${fullscreen ? 'fullscreen' : ''}`} style={{ width: '100%', backgroundColor: 'black' }}>
            <div className="video-wrapper" style={{ width: '100%', position: 'relative', display: 'flex', justifyContent: 'center', backgroundColor: '#000' }}>
                <video
                    ref={videoRef}
                    src={streamUrl}
                    className="vjs-tech"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onClick={togglePlay}
                />

                <div className="custom-controls" style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 20px',
                    background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    zIndex: 10,
                    height: 'auto'
                }}>
                    <Button variant="link" onClick={togglePlay} className="text-light mr-3 p-0">
                        <Icon icon={playing ? faPause : faPlay} size="lg" />
                    </Button>

                    <div className="text-light mr-3 font-weight-bold" style={{ minWidth: '100px' }}>
                        {TextUtils.secondsToTimestamp(Math.max(0, currentTime - startPoint))} / <span className="text-muted">{TextUtils.secondsToTimestamp(duration)}</span>
                    </div>

                    <input
                        type="range"
                        min={0}
                        max={duration}
                        step={0.1}
                        value={Math.max(0, currentTime - startPoint)}
                        onChange={(e) => {
                            const time = Number(e.target.value);
                            if (videoRef.current) {
                                videoRef.current.currentTime = startPoint + time;
                            }
                            setCurrentTime(startPoint + time);
                        }}
                        style={{ flexGrow: 1, margin: '0 15px', cursor: 'pointer' }}
                    />

                    <div className="d-flex align-items-center">
                        <div className="volume-control d-flex align-items-center ml-2">
                            <Button variant="link" onClick={toggleMute} className="text-light p-0">
                                <Icon icon={muted || volume === 0 ? faVolumeMute : faVolumeUp} />
                            </Button>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={muted ? 0 : volume}
                                onChange={handleVolumeChange}
                                style={{ width: '80px', marginLeft: '10px', height: '4px' }}
                            />
                        </div>

                        <Button variant="link" onClick={toggleFullscreen} className="text-light ml-3 p-0">
                            <Icon icon={fullscreen ? faCompress : faExpand} />
                        </Button>
                    </div>
                </div>
            </div>

            {file && (
                <ScenePlayerScrubber
                    file={file}
                    scene={scene}
                    time={currentTime}
                    start={startPoint}
                    end={endPoint}
                    onSeek={onScrubberSeek}
                    onScroll={onScrubberScroll}
                />
            )}
        </div>
    );
};
