import React, { useRef, useState, useEffect, useCallback } from "react";
import { Box, IconButton, useTheme, useMediaQuery, alpha } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

interface CarouselProps {
    children: React.ReactNode;
    autoPlay?: boolean;
    autoPlayInterval?: number;
    showArrows?: boolean;
    gap?: number;
    itemWidth?: number;
}

export const Carousel: React.FC<CarouselProps> = ({
    children,
    autoPlay = true,
    autoPlayInterval = 5000,
    showArrows = true,
    gap = 16,
    itemWidth = 320,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
    const isTablet = useMediaQuery(theme.breakpoints.between("sm", "md"));
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(true);
    const [isPaused, setIsPaused] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);

    const updateScrollButtons = useCallback(() => {
        if (scrollRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
            setCanScrollLeft(scrollLeft > 0);
            setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
        }
    }, []);

    useEffect(() => {
        const scrollContainer = scrollRef.current;
        if (scrollContainer) {
            scrollContainer.addEventListener("scroll", updateScrollButtons);
            updateScrollButtons();
            return () => scrollContainer.removeEventListener("scroll", updateScrollButtons);
        }
    }, [updateScrollButtons]);

    useEffect(() => {
        if (!autoPlay || isPaused || isMobile) return;

        const interval = setInterval(() => {
            if (scrollRef.current) {
                const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
                if (scrollLeft >= scrollWidth - clientWidth - 1) {
                    // Reset to beginning with smooth animation
                    scrollRef.current.scrollTo({ left: 0, behavior: "smooth" });
                } else {
                    // Scroll by one item width
                    scrollRef.current.scrollBy({ left: itemWidth + gap, behavior: "smooth" });
                }
            }
        }, autoPlayInterval);

        return () => clearInterval(interval);
    }, [autoPlay, autoPlayInterval, isPaused, isMobile, itemWidth, gap]);

    const scroll = (direction: "left" | "right") => {
        if (scrollRef.current) {
            const scrollAmount = (itemWidth + gap) * (isTablet ? 1.5 : 2);
            scrollRef.current.scrollBy({
                left: direction === "left" ? -scrollAmount : scrollAmount,
                behavior: "smooth",
            });
        }
    };

    // Touch/mouse drag handlers for mobile-like swipe on desktop
    const handleMouseDown = (e: React.MouseEvent) => {
        if (isMobile) return; // Use native touch scroll on mobile
        setIsDragging(true);
        setStartX(e.pageX - (scrollRef.current?.offsetLeft || 0));
        setScrollLeft(scrollRef.current?.scrollLeft || 0);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || !scrollRef.current) return;
        e.preventDefault();
        const x = e.pageX - (scrollRef.current.offsetLeft || 0);
        const walk = (x - startX) * 1.5; // Scroll speed multiplier
        scrollRef.current.scrollLeft = scrollLeft - walk;
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const childArray = React.Children.toArray(children);

    // Calculate responsive item width
    const responsiveItemWidth = isMobile ? "85vw" : isTablet ? "45vw" : `${itemWidth}px`;

    return (
        <Box
            sx={{ 
                position: "relative",
                // Gradient fade on edges to indicate more content
                "&::before, &::after": {
                    content: '""',
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    width: { xs: 20, md: 60 },
                    pointerEvents: "none",
                    zIndex: 5,
                    transition: "opacity 0.3s ease",
                },
                "&::before": {
                    left: 0,
                    background: (t) => `linear-gradient(to right, ${t.palette.background.default}, transparent)`,
                    opacity: canScrollLeft ? 1 : 0,
                },
                "&::after": {
                    right: 0,
                    background: (t) => `linear-gradient(to left, ${t.palette.background.default}, transparent)`,
                    opacity: canScrollRight ? 1 : 0,
                },
            }}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => {
                setIsPaused(false);
                setIsDragging(false);
            }}
        >
            {/* Left Arrow */}
            {showArrows && !isMobile && (
                <IconButton
                    onClick={() => scroll("left")}
                    sx={{
                        position: "absolute",
                        left: { xs: -16, md: -24 },
                        top: "50%",
                        transform: "translateY(-50%)",
                        zIndex: 10,
                        bgcolor: (t) => alpha(t.palette.background.paper, 0.9),
                        backdropFilter: "blur(8px)",
                        color: "text.primary",
                        border: 1,
                        borderColor: "divider",
                        opacity: canScrollLeft ? 1 : 0,
                        visibility: canScrollLeft ? "visible" : "hidden",
                        transition: "all 0.2s ease",
                        "&:hover": {
                            bgcolor: "primary.main",
                            color: "primary.contrastText",
                            transform: "translateY(-50%) scale(1.1)",
                            boxShadow: (t) => `0 0 20px ${alpha(t.palette.primary.main, 0.4)}`,
                        },
                        width: { xs: 36, md: 44 },
                        height: { xs: 36, md: 44 },
                    }}
                >
                    <ChevronLeftIcon />
                </IconButton>
            )}

            {/* Scrollable Container */}
            <Box
                ref={scrollRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                sx={{
                    display: "flex",
                    gap: `${gap}px`,
                    overflowX: "auto",
                    scrollSnapType: "x mandatory",
                    scrollbarWidth: "none",
                    msOverflowStyle: "none",
                    "&::-webkit-scrollbar": {
                        display: "none",
                    },
                    px: isMobile ? 2 : 0,
                    py: 1,
                    cursor: isDragging ? "grabbing" : "grab",
                    userSelect: isDragging ? "none" : "auto",
                    // Smooth momentum scrolling on iOS
                    WebkitOverflowScrolling: "touch",
                }}
            >
                {childArray.map((child, index) => (
                    <Box
                        key={index}
                        sx={{
                            flexShrink: 0,
                            scrollSnapAlign: "start",
                            width: responsiveItemWidth,
                            maxWidth: responsiveItemWidth,
                            transition: "transform 0.3s ease, opacity 0.3s ease",
                            "&:hover": {
                                transform: isMobile ? "none" : "scale(1.02)",
                            },
                        }}
                    >
                        {child}
                    </Box>
                ))}
            </Box>

            {/* Right Arrow */}
            {showArrows && !isMobile && (
                <IconButton
                    onClick={() => scroll("right")}
                    sx={{
                        position: "absolute",
                        right: { xs: -16, md: -24 },
                        top: "50%",
                        transform: "translateY(-50%)",
                        zIndex: 10,
                        bgcolor: (t) => alpha(t.palette.background.paper, 0.9),
                        backdropFilter: "blur(8px)",
                        color: "text.primary",
                        border: 1,
                        borderColor: "divider",
                        opacity: canScrollRight ? 1 : 0,
                        visibility: canScrollRight ? "visible" : "hidden",
                        transition: "all 0.2s ease",
                        "&:hover": {
                            bgcolor: "primary.main",
                            color: "primary.contrastText",
                            transform: "translateY(-50%) scale(1.1)",
                            boxShadow: (t) => `0 0 20px ${alpha(t.palette.primary.main, 0.4)}`,
                        },
                        width: { xs: 36, md: 44 },
                        height: { xs: 36, md: 44 },
                    }}
                >
                    <ChevronRightIcon />
                </IconButton>
            )}

            {/* Mobile scroll indicator dots */}
            {isMobile && childArray.length > 1 && (
                <Box
                    sx={{
                        display: "flex",
                        justifyContent: "center",
                        gap: 0.5,
                        mt: 2,
                    }}
                >
                    {childArray.slice(0, Math.min(5, childArray.length)).map((_, index) => (
                        <Box
                            key={index}
                            sx={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                bgcolor: "grey.600",
                                transition: "all 0.2s ease",
                            }}
                        />
                    ))}
                    {childArray.length > 5 && (
                        <Box sx={{ color: "grey.600", fontSize: "0.75rem", ml: 0.5 }}>
                            +{childArray.length - 5}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default Carousel;
