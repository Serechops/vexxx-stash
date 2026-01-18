import React, { useRef, useState, useEffect, useCallback } from "react";
import { Box, IconButton, Slider } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import CloseIcon from "@mui/icons-material/Close";
import TextUtils from "src/utils/text";

// HLS.js type declaration for dynamic import
interface HlsType {
    new(config?: Record<string, unknown>): HlsInstance;
    isSupported: () => boolean;
    Events: {
        MANIFEST_PARSED: string;
        ERROR: string;
    };
}

interface HlsInstance {
    loadSource: (src: string) => void;
    attachMedia: (media: HTMLVideoElement) => void;
    destroy: () => void;
    on: (event: string, callback: (event: string, data: { fatal?: boolean; type?: string }) => void) => void;
}

declare global {
    interface Window {
        Hls?: HlsType;
    }
}

interface ITrailerPlayerProps {
    url: string;
    onClose?: () => void;
}

// Load HLS.js from CDN dynamically
const loadHlsJs = (): Promise<HlsType | null> => {
    return new Promise((resolve) => {
        if (window.Hls) {
            resolve(window.Hls);
            return;
        }

        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
        script.onload = () => {
            resolve(window.Hls || null);
        };
        script.onerror = () => {
            console.error("Failed to load HLS.js");
            resolve(null);
        };
        document.head.appendChild(script);
    });
};

const isHlsUrl = (url: string): boolean => {
    return url.includes(".m3u8");
};

// Check if URL needs to be proxied (external URLs that may have CORS issues)
const needsProxy = (url: string): boolean => {
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes("adultempire.com") || lowerUrl.includes("adultdvdempire.com");
};

// Construct proxied URL to bypass CORS
const getProxiedUrl = (url: string): string => {
    if (!needsProxy(url)) return url;
    const encodedUrl = encodeURIComponent(url);
    return `/proxy/media?url=${encodedUrl}`;
};

export const TrailerPlayer: React.FC<ITrailerPlayerProps> = ({ url, onClose }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<HlsInstance | null>(null);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Initialize video source (HLS or native)
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !url) return;

        const initPlayer = async () => {
            setLoading(true);
            setError(null);

            // Cleanup previous HLS instance
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }

            // Use proxied URL for external sources to bypass CORS
            const sourceUrl = getProxiedUrl(url);

            if (isHlsUrl(url)) {
                // Check if native HLS is supported (Safari)
                if (video.canPlayType("application/vnd.apple.mpegurl")) {
                    video.src = sourceUrl;
                    setLoading(false);
                } else {
                    // Load HLS.js for non-Safari browsers
                    const Hls = await loadHlsJs();
                    if (Hls && Hls.isSupported()) {
                        const hls = new Hls({
                            enableWorker: true,
                            lowLatencyMode: false,
                        });
                        hlsRef.current = hls;
                        hls.loadSource(sourceUrl);
                        hls.attachMedia(video);
                        hls.on(Hls.Events.MANIFEST_PARSED, () => {
                            setLoading(false);
                            video.play().catch(() => { });
                        });
                        hls.on(Hls.Events.ERROR, (_, data) => {
                            if (data.fatal) {
                                setError(`HLS Error: ${data.type}`);
                                setLoading(false);
                            }
                        });
                    } else {
                        setError("HLS playback not supported in this browser");
                        setLoading(false);
                    }
                }
            } else {
                // Regular video source (MP4, WebM, etc.)
                video.src = sourceUrl;
                setLoading(false);
            }
        };

        initPlayer();

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [url]);

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
            setCurrentTime(videoRef.current.currentTime);
        }
    }, []);

    const handleLoadedMetadata = useCallback(() => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration);
        }
    }, []);

    const handleVolumeChange = (_e: Event, newValue: number | number[]) => {
        const newVolume = newValue as number;
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

    const handleSeek = (_e: Event, newValue: number | number[]) => {
        const seekTime = newValue as number;
        if (videoRef.current) {
            videoRef.current.currentTime = seekTime;
            setCurrentTime(seekTime);
        }
    };

    const toggleFullscreen = () => {
        if (!document.fullscreenElement && containerRef.current) {
            containerRef.current.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    useEffect(() => {
        const onFSChange = () => setFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFSChange);
        return () => document.removeEventListener("fullscreenchange", onFSChange);
    }, []);

    // Autoplay on mount (for non-HLS, HLS autoplay is handled in initPlayer)
    useEffect(() => {
        if (videoRef.current && !isHlsUrl(url)) {
            videoRef.current.play().catch(() => {
                // Autoplay blocked, user needs to interact
            });
        }
    }, [url]);

    return (
        <Box
            ref={containerRef}
            sx={{
                position: "relative",
                width: "100%",
                backgroundColor: "#000",
                borderRadius: fullscreen ? 0 : 2,
                overflow: "hidden",
                minHeight: 300,
            }}
        >
            {onClose && !fullscreen && (
                <IconButton
                    onClick={onClose}
                    sx={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        zIndex: 20,
                        backgroundColor: "rgba(0,0,0,0.5)",
                        color: "white",
                        "&:hover": { backgroundColor: "rgba(0,0,0,0.7)" },
                    }}
                >
                    <CloseIcon />
                </IconButton>
            )}

            {loading && (
                <Box
                    sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        color: "white",
                        fontSize: "1rem",
                    }}
                >
                    Loading trailer...
                </Box>
            )}

            {error && (
                <Box
                    sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        color: "error.main",
                        fontSize: "1rem",
                        textAlign: "center",
                        p: 2,
                    }}
                >
                    {error}
                </Box>
            )}

            <video
                ref={videoRef}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onClick={togglePlay}
                crossOrigin="anonymous"
            />

            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    p: 1.5,
                    background: "linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)",
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    zIndex: 10,
                }}
            >
                <IconButton onClick={togglePlay} sx={{ color: "white" }}>
                    {playing ? <PauseIcon /> : <PlayArrowIcon />}
                </IconButton>

                <Box sx={{ color: "white", fontSize: "0.875rem", minWidth: 100 }}>
                    {TextUtils.secondsToTimestamp(currentTime)} /{" "}
                    <span style={{ opacity: 0.6 }}>{TextUtils.secondsToTimestamp(duration)}</span>
                </Box>

                <Slider
                    size="small"
                    value={currentTime}
                    max={duration || 100}
                    onChange={handleSeek}
                    sx={{
                        flex: 1,
                        color: "primary.main",
                        "& .MuiSlider-thumb": { width: 12, height: 12 },
                    }}
                />

                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: 1 }}>
                    <IconButton onClick={toggleMute} sx={{ color: "white" }} size="small">
                        {muted || volume === 0 ? <VolumeOffIcon /> : <VolumeUpIcon />}
                    </IconButton>
                    <Slider
                        size="small"
                        value={muted ? 0 : volume}
                        max={1}
                        step={0.05}
                        onChange={handleVolumeChange}
                        sx={{ width: 60, color: "white" }}
                    />
                </Box>

                <IconButton onClick={toggleFullscreen} sx={{ color: "white" }} size="small">
                    {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                </IconButton>
            </Box>
        </Box>
    );
};
