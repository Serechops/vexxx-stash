import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";
import { useConfigurationContextOptional } from "src/hooks/Config";
import { IUIConfig } from "src/core/config";
import { SFWHeroPlaceholder } from "src/components/Shared/SFWHeroPlaceholder";
import { Tooltip, Box, Typography, Button, Avatar, AvatarGroup } from "@mui/material";
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
 * Hero banner for the main Galleries listing page.
 * Features an elegant split-panel showcase with dynamic hover-syncing, smooth transitions, and glassmorphic panels.
 */
export const GalleriesHero: React.FC = () => {
    const history = useHistory();
    const [activeIndex, setActiveIndex] = useState(0);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [prevImage, setPrevImage] = useState<string | null>(null);
    const { configuration } = useConfigurationContextOptional() || {};

    // Fetch random galleries
    const { data, loading } = GQL.useFindGalleriesQuery({
        variables: {
            filter: {
                per_page: 12,
                sort: "random",
            },
        },
        fetchPolicy: "no-cache",
    });

    const galleries = (data?.findGalleries?.galleries || []).filter(
        (g) => g.paths?.cover
    );

    // Auto-advance with elegant timing
    useEffect(() => {
        if (galleries.length === 0) return;

        const interval = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % Math.min(galleries.length, 6));
        }, 8000);

        return () => clearInterval(interval);
    }, [galleries.length]);

    const sideGalleries = galleries.slice(0, 6);
    
    // Determine which gallery is currently displayed on the left panel
    const currentDisplayIndex = hoveredIndex !== null ? hoveredIndex : activeIndex;
    const featuredGallery = sideGalleries[currentDisplayIndex] || sideGalleries[0];

    // Keep track of the previous image for cross-fading
    const currentCoverPath = featuredGallery?.paths?.cover || "";
    
    useEffect(() => {
        if (currentCoverPath) {
            setPrevImage(currentCoverPath);
        }
    }, [currentCoverPath]);

    const uiConfig = configuration?.ui as IUIConfig | undefined;
    if (configuration?.interface?.sfwContentMode && (uiConfig?.sfwBlurGalleries ?? true)) return <SFWHeroPlaceholder />;

    if (loading || galleries.length === 0) return null;

    const handleGalleryClick = (galleryId: string) => {
        history.push(`/galleries/${galleryId}`);
    };

    const getInitials = (name: string) => {
        return name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
    };

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
            {/* Split Screen Container */}
            <Box sx={{ position: "absolute", inset: 0, display: "flex", height: "100%", width: "100%" }}>
                
                {/* Left Side: Large Featured Gallery (2/3 width) */}
                <Box 
                    onClick={() => handleGalleryClick(featuredGallery.id)}
                    sx={{
                        position: "relative",
                        width: "66.666667%",
                        height: "100%",
                        overflow: "hidden",
                        cursor: "pointer",
                        pointerEvents: "auto",
                    }}
                >
                    {/* Background Cross-fade image stack */}
                    <Box sx={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                        {prevImage && prevImage !== currentCoverPath && (
                            <Box
                                key={`prev-${prevImage}`}
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
                                        src={prevImage}
                                        alt=""
                                        sx={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                            filter: "blur(4px)",
                                            transform: "scale(1.1)",
                                        }}
                                    />
                                </Box>
                            </Box>
                        )}
                        {currentCoverPath && (
                            <Box
                                key={`curr-${currentCoverPath}`}
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
                                        src={currentCoverPath}
                                        alt=""
                                        sx={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                            filter: "blur(4px)",
                                            transform: "scale(1.1)",
                                        }}
                                    />
                                </Box>
                            </Box>
                        )}
                        {/* Vignette/Parallax gradients */}
                        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(0,0,0,0.5), transparent 40%, rgba(0,0,0,0.8) 100%)", zIndex: 5 }} />
                        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.9), transparent 50%, rgba(0,0,0,0.3) 100%)", zIndex: 5 }} />
                    </Box>

                    {/* Left Panel: Glassmorphic Details Card */}
                    {featuredGallery && (
                        <Box 
                            key={`details-${featuredGallery.id}`}
                            onClick={(e) => {
                                // Prevent double-navigation from parent onClick
                                e.stopPropagation();
                                handleGalleryClick(featuredGallery.id);
                            }}
                            sx={{
                                position: "absolute",
                                bottom: "48px",
                                left: "48px",
                                backdropFilter: "blur(24px)",
                                bgcolor: "rgba(0, 0, 0, 0.45)",
                                border: "1px solid rgba(255, 255, 255, 0.1)",
                                borderRadius: "16px",
                                p: 4,
                                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 2.5,
                                textAlign: "left",
                                maxWidth: "512px",
                                zIndex: 10,
                                pointerEvents: "auto",
                                transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
                                "&:hover": {
                                    borderColor: "rgba(255, 255, 255, 0.25)",
                                    boxShadow: (theme) => `0 25px 50px -12px ${alpha(theme.palette.primary.main, 0.1)}`,
                                },
                            }}
                        >
                            {/* Card Header */}
                            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <Box
                                    sx={{
                                        fontSize: "0.75rem",
                                        fontWeight: 600,
                                        letterSpacing: "0.05em",
                                        color: "primary.main",
                                        textTransform: "uppercase",
                                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                                        border: "1px solid",
                                        borderColor: (theme) => alpha(theme.palette.primary.main, 0.2),
                                        px: 1.5,
                                        py: 0.5,
                                        borderRadius: "6px",
                                    }}
                                >
                                    Featured Collection
                                </Box>
                                <Typography sx={{ fontSize: "0.75rem", fontFamily: "monospace", color: "rgba(255, 255, 255, 0.5)" }}>
                                    {String(currentDisplayIndex + 1).padStart(2, "0")} &nbsp;/&nbsp; 06
                                </Typography>
                            </Box>

                            {/* Title */}
                            {featuredGallery.title && (
                                <Typography
                                    variant="h4"
                                    sx={{
                                        fontWeight: 700,
                                        color: "white",
                                        lineHeight: 1.25,
                                        display: "-webkit-box",
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                                    }}
                                >
                                    {featuredGallery.title}
                                </Typography>
                            )}

                            {/* Images count info */}
                            {featuredGallery.image_count !== undefined && (
                                <Box
                                    sx={{
                                        display: "inline-block",
                                        alignSelf: "flex-start",
                                        fontSize: "0.875rem",
                                        color: "rgba(255, 255, 255, 0.7)",
                                        fontWeight: 300,
                                        bgcolor: "rgba(255, 255, 255, 0.05)",
                                        border: "1px solid rgba(255, 255, 255, 0.05)",
                                        px: 1.5,
                                        py: 0.25,
                                        borderRadius: "9999px",
                                    }}
                                >
                                    {featuredGallery.image_count} {featuredGallery.image_count === 1 ? "image" : "images"}
                                </Box>
                            )}

                            {/* Performers */}
                            {featuredGallery.performers && featuredGallery.performers.length > 0 && (
                                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                                    <Typography
                                        sx={{
                                            fontSize: "10px",
                                            fontWeight: 600,
                                            letterSpacing: "0.15em",
                                            color: "rgba(255, 255, 255, 0.4)",
                                            textTransform: "uppercase",
                                        }}
                                    >
                                        Performers
                                    </Typography>
                                    <AvatarGroup
                                        max={5}
                                        sx={{
                                            justifyContent: "flex-end",
                                            alignSelf: "flex-start",
                                            "& .MuiAvatar-root": {
                                                width: 36,
                                                height: 36,
                                                fontSize: "0.75rem",
                                                fontWeight: 600,
                                                border: "2px solid black",
                                                cursor: "pointer",
                                                transition: "all 0.2s ease",
                                                "&:hover": {
                                                    transform: "scale(1.15)",
                                                    zIndex: "30 !important",
                                                },
                                            },
                                        }}
                                    >
                                        {featuredGallery.performers.map((performer) => (
                                            <Tooltip key={performer.id} title={performer.name}>
                                                {performer.image_path ? (
                                                    <Avatar
                                                        src={performer.image_path}
                                                        alt={performer.name}
                                                    />
                                                ) : (
                                                    <Avatar
                                                        sx={{
                                                            bgcolor: "secondary.main",
                                                            color: "secondary.contrastText",
                                                        }}
                                                    >
                                                        {getInitials(performer.name)}
                                                    </Avatar>
                                                )}
                                            </Tooltip>
                                        ))}
                                    </AvatarGroup>
                                </Box>
                            )}

                            {/* Studio */}
                            {featuredGallery.studio && (
                                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                                    <Typography
                                        sx={{
                                            fontSize: "10px",
                                            fontWeight: 600,
                                            letterSpacing: "0.15em",
                                            color: "rgba(255, 255, 255, 0.4)",
                                            textTransform: "uppercase",
                                        }}
                                    >
                                        Studio
                                    </Typography>
                                    <Box
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 1,
                                            bgcolor: "rgba(255, 255, 255, 0.05)",
                                            border: "1px solid rgba(255, 255, 255, 0.1)",
                                            borderRadius: "12px",
                                            px: 1.5,
                                            py: 0.75,
                                            width: "fit-content",
                                        }}
                                    >
                                        {featuredGallery.studio.image_path && (
                                            <Box
                                                component="img"
                                                src={featuredGallery.studio.image_path}
                                                alt=""
                                                sx={{ height: "16px", maxWidth: "50px", objectFit: "contain" }}
                                            />
                                        )}
                                        <Typography sx={{ color: "rgba(255, 255, 255, 0.8)", fontSize: "0.75rem", fontWeight: 500 }}>
                                            {featuredGallery.studio.name}
                                        </Typography>
                                    </Box>
                                </Box>
                            )}

                            {/* Action Button */}
                            <Box sx={{ pt: 1 }}>
                                <Button
                                    variant="contained"
                                    color="primary"
                                    sx={{
                                        px: 3,
                                        py: 1.5,
                                        borderRadius: "12px",
                                        fontWeight: 600,
                                        textTransform: "none",
                                        boxShadow: (theme) => `0 10px 15px -3px ${alpha(theme.palette.primary.main, 0.2)}`,
                                        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 1,
                                        "&:hover": {
                                            boxShadow: (theme) => `0 10px 20px -3px ${alpha(theme.palette.primary.main, 0.4)}`,
                                            transform: "scale(1.02)",
                                            "& svg": {
                                                transform: "translateX(4px)",
                                            },
                                        },
                                        "&:active": {
                                            transform: "scale(0.98)",
                                        },
                                    }}
                                >
                                    <span>Enter Gallery</span>
                                    <svg
                                        style={{ width: "16px", height: "16px", transition: "transform 0.3s ease" }}
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                    </svg>
                                </Button>
                            </Box>
                        </Box>
                    )}
                </Box>

                {/* Right Side: Interactive justified row grid (1/3 width) */}
                <Box
                    sx={{
                        position: "relative",
                        width: "33.333333%",
                        height: "100%",
                        bgcolor: "rgba(0, 0, 0, 0.4)",
                        backdropFilter: "blur(24px)",
                        borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
                        zIndex: 10,
                        display: "flex",
                        flexDirection: "column",
                        p: 3,
                        pt: 8,
                        textAlign: "left",
                    }}
                >
                    <Box
                        sx={{
                            fontSize: "10px",
                            fontWeight: 700,
                            letterSpacing: "0.15em",
                            color: "primary.main",
                            textTransform: "uppercase",
                            mb: 2,
                            pl: 1,
                        }}
                    >
                        Showcase Collections
                    </Box>
                    <Box 
                        sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, 1fr)",
                            gridTemplateRows: `repeat(${Math.ceil(sideGalleries.length / 2)}, minmax(0, 1fr))`,
                            gap: 1.5,
                            flex: 1,
                            pb: 2,
                            pointerEvents: "auto",
                        }}
                    >
                        {sideGalleries.map((gallery, index) => {
                            const isSelected = index === currentDisplayIndex;
                            const isHovered = hoveredIndex === index;
                            
                            return (
                                <Box
                                    key={gallery.id}
                                    onClick={() => handleGalleryClick(gallery.id)}
                                    onMouseEnter={() => setHoveredIndex(index)}
                                    onMouseLeave={() => setHoveredIndex(null)}
                                    sx={{
                                        position: "relative",
                                        borderRadius: "12px",
                                        overflow: "hidden",
                                        cursor: "pointer",
                                        width: "100%",
                                        height: "100%",
                                        border: "1px solid",
                                        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                                        bgcolor: isSelected ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.05)",
                                        borderColor: isSelected ? "primary.main" : "rgba(255, 255, 255, 0.05)",
                                        opacity: isSelected ? 1 : 0.7,
                                        transform: isSelected ? "scale(1.02)" : "scale(1)",
                                        boxShadow: isSelected ? (theme) => `0 4px 12px ${alpha(theme.palette.primary.main, 0.1)}` : "0 1px 3px rgba(0,0,0,0.12)",
                                        "&:hover": {
                                            opacity: 1,
                                            bgcolor: "rgba(255, 255, 255, 0.1)",
                                            borderColor: isSelected ? "primary.main" : "rgba(255, 255, 255, 0.15)",
                                        },
                                    }}
                                >
                                    <Box
                                        component="img"
                                        src={gallery.paths?.cover || ""}
                                        alt=""
                                        sx={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                            transition: "transform 0.7s ease",
                                            transform: isHovered ? "scale(1.1)" : "scale(1)",
                                        }}
                                    />
                                    {/* Cover gradient overlay */}
                                    <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.3) 40%, transparent 100%)" }} />
                                    
                                    {/* Content Info */}
                                    <Box sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", p: 1.5 }}>
                                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5, width: "100%" }}>
                                            <Typography
                                                sx={{
                                                    color: "white",
                                                    fontWeight: 600,
                                                    fontSize: "0.75rem",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                    maxWidth: "85%",
                                                }}
                                            >
                                                {gallery.title || `Gallery #${gallery.id}`}
                                            </Typography>
                                            {isSelected && (
                                                <Box sx={{ height: "6px", width: "6px", borderRadius: "50%", bgcolor: "primary.main", flexShrink: 0 }} />
                                            )}
                                        </Box>
                                        {gallery.image_count !== undefined && (
                                            <Typography sx={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "10px" }}>
                                                {gallery.image_count} imgs
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                </Box>

            </Box>

            {/* Ambient gradients */}
            <Box
                sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: "33.333333%",
                    background: (theme) => `linear-gradient(to top, ${theme.palette.background.default}, ${alpha(theme.palette.background.default, 0.6)}, transparent)`,
                    zIndex: 20,
                    pointerEvents: "none",
                }}
            />
            <Box
                sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: "128px",
                    background: (theme) => `linear-gradient(to bottom, ${alpha(theme.palette.background.default, 0.8)}, transparent)`,
                    zIndex: 20,
                    pointerEvents: "none",
                }}
            />
        </Box>
    );
};
