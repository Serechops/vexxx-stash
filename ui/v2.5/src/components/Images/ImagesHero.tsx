import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";
import { useConfigurationContextOptional } from "src/hooks/Config";
import { IUIConfig } from "src/core/config";
import { SFWHeroPlaceholder } from "src/components/Shared/SFWHeroPlaceholder";
import { Tooltip, Box, Typography } from "@mui/material";
import { alpha, keyframes } from "@mui/material/styles";

// Animation keyframes defined locally using Emotion
const kenBurns = keyframes`
  0% {
    transform: scale(1) translate(0, 0);
  }
  50% {
    transform: scale(1.08) translate(-1.5%, -1%);
  }
  100% {
    transform: scale(1) translate(0, 0);
  }
`;

const floatAnim = keyframes`
  0%, 100% {
    transform: translateY(0) translateX(0);
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    transform: translateY(-100vh) translateX(10vw);
    opacity: 0;
  }
`;

const fadeIn = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const fadeOut = keyframes`
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
`;

/**
 * Hero banner for the main Images listing page.
 * Features an elegant grid mosaic with smooth transitions and glassmorphic panels.
 */
export const ImagesHero: React.FC = () => {
    const history = useHistory();
    const [activeIndex, setActiveIndex] = useState(0);
    const [prevImage, setPrevImage] = useState<GQL.SlimImageDataFragment | null>(null);
    const { configuration } = useConfigurationContextOptional() || {};

    // Fetch random images
    const { data, loading } = GQL.useFindImagesQuery({
        variables: {
            filter: {
                per_page: 15,
                sort: "random",
            },
            image_filter: {},
        },
        fetchPolicy: "no-cache",
    });

    const images = data?.findImages?.images || [];
    const featuredImage = images[activeIndex];

    // Auto-advance with elegant transition
    useEffect(() => {
        if (images.length === 0) return;

        const interval = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % images.length);
        }, 8000);

        return () => clearInterval(interval);
    }, [images.length]);

    // Keep track of the previous image for cross-fading
    useEffect(() => {
        if (featuredImage) {
            setPrevImage(featuredImage);
        }
    }, [activeIndex, featuredImage]);

    const uiConfig = configuration?.ui as IUIConfig | undefined;
    if (configuration?.interface?.sfwContentMode && (uiConfig?.sfwBlurImages ?? true)) return <SFWHeroPlaceholder />;

    if (loading || images.length === 0) return null;

    const thumbnailImages = images.slice(0, 8);

    return (
        <Box
            sx={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                zIndex: 0,
                bgcolor: "black",
                userSelect: "none",
                overflow: "hidden",
                display: { xs: "none", md: "block" },
            }}
        >
            {/* Main Featured Image with Ken Burns Effect */}
            <Box sx={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                {/* Previous image (fading out) */}
                {prevImage && prevImage.id !== featuredImage?.id && (
                    <Box
                        key={`prev-${prevImage.id}`}
                        sx={{
                            position: "absolute",
                            inset: 0,
                            animation: `${fadeOut} 1.2s ease-in-out forwards`,
                        }}
                    >
                        <Box
                            sx={{
                                position: "absolute",
                                inset: 0,
                                animation: `${kenBurns} 24s ease-in-out infinite`,
                            }}
                        >
                            <Box
                                component="img"
                                src={prevImage.paths?.preview || prevImage.paths?.thumbnail || ""}
                                alt=""
                                sx={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    filter: "blur(8px)",
                                    transform: "scale(1.1)",
                                }}
                            />
                        </Box>
                    </Box>
                )}
                {/* Current image (fading in) */}
                {featuredImage && (
                    <Box
                        key={`curr-${featuredImage.id}`}
                        sx={{
                            position: "absolute",
                            inset: 0,
                            animation: `${fadeIn} 1.2s ease-in-out forwards`,
                        }}
                    >
                        <Box
                            sx={{
                                position: "absolute",
                                inset: 0,
                                animation: `${kenBurns} 24s ease-in-out infinite`,
                            }}
                        >
                            <Box
                                component="img"
                                src={featuredImage.paths?.preview || featuredImage.paths?.thumbnail || ""}
                                alt=""
                                sx={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    filter: "blur(8px)",
                                    transform: "scale(1.1)",
                                }}
                            />
                        </Box>
                    </Box>
                )}
                {/* Vignette overlay */}
                <Box
                    sx={{
                        position: "absolute",
                        inset: 0,
                        background: "radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.9) 100%)",
                        zIndex: 5,
                    }}
                />
            </Box>

            {/* Elegant Gradient Overlays */}
            <Box
                sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: "66.666667%",
                    background: (theme) => `linear-gradient(to top, ${theme.palette.background.default}, ${alpha(theme.palette.background.default, 0.8)}, transparent)`,
                    zIndex: 10,
                }}
            />
            <Box
                sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: "192px",
                    background: (theme) => `linear-gradient(to bottom, ${alpha(theme.palette.background.default, 0.9)}, transparent)`,
                    zIndex: 10,
                }}
            />
            <Box
                sx={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: "128px",
                    background: (theme) => `linear-gradient(to right, ${alpha(theme.palette.background.default, 0.6)}, transparent)`,
                    zIndex: 10,
                }}
            />
            <Box
                sx={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    right: 0,
                    width: "128px",
                    background: (theme) => `linear-gradient(to left, ${alpha(theme.palette.background.default, 0.6)}, transparent)`,
                    zIndex: 10,
                }}
            />

            {/* Main Grid Content container */}
            <Box
                sx={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    px: 8,
                    zIndex: 20,
                    pointerEvents: "none",
                }}
            >
                {/* Right Side: Interactive Grid Mosaic */}
                <Box sx={{ width: "45%", maxWidth: "512px", p: 2, pointerEvents: "auto" }}>
                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(4, 1fr)",
                            gap: 1.5,
                        }}
                    >
                        {thumbnailImages.map((image, index) => {
                            const isActive = index === activeIndex % thumbnailImages.length;
                            
                            return (
                                <Box
                                    key={image.id}
                                    onClick={() => setActiveIndex(index)}
                                    sx={{
                                        position: "relative",
                                        aspectRatio: "3/4",
                                        borderRadius: "12px",
                                        overflow: "hidden",
                                        cursor: "pointer",
                                        border: "2px solid",
                                        transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
                                        zIndex: isActive ? 10 : 1,
                                        borderColor: (theme) =>
                                            isActive
                                                ? "primary.main"
                                                : "rgba(255, 255, 255, 0.1)",
                                        opacity: isActive ? 1 : 0.6,
                                        transform: isActive ? "scale(1.05)" : "scale(1)",
                                        boxShadow: (theme) =>
                                            isActive
                                                ? `0 4px 20px ${alpha(theme.palette.primary.main, 0.2)}`
                                                : "0 4px 6px rgba(0, 0, 0, 0.1)",
                                        "&:hover": {
                                            opacity: 1,
                                            transform: isActive ? "scale(1.05)" : "scale(1.02)",
                                            borderColor: (theme) =>
                                                isActive
                                                    ? "primary.main"
                                                    : "rgba(255, 255, 255, 0.25)",
                                            boxShadow: "0 10px 15px rgba(0, 0, 0, 0.2)",
                                        },
                                    }}
                                >
                                    <Box
                                        component="img"
                                        src={image.paths.thumbnail || ""}
                                        alt=""
                                        sx={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                        }}
                                    />
                                    <Box
                                        sx={{
                                            position: "absolute",
                                            inset: 0,
                                            background: "linear-gradient(to top, rgba(0, 0, 0, 0.5), transparent, transparent)",
                                            opacity: 0.6,
                                        }}
                                    />
                                </Box>
                            );
                        })}
                    </Box>
                </Box>
            </Box>

            {/* Subtle animated particles/dots for depth */}
            <Box sx={{ position: "absolute", inset: 0, zIndex: 15, pointerEvents: "none", opacity: 0.2 }}>
                {[...Array(20)].map((_, i) => (
                    <Box
                        key={i}
                        sx={{
                            position: "absolute",
                            width: "4px",
                            height: "4px",
                            bgcolor: "white",
                            borderRadius: "50%",
                            left: `${Math.random() * 100}%`,
                            top: `${Math.random() * 100}%`,
                            animation: `${floatAnim} linear infinite`,
                            animationDelay: `${Math.random() * 5}s`,
                            animationDuration: `${10 + Math.random() * 10}s`,
                        }}
                    />
                ))}
            </Box>
        </Box>
    );
};
