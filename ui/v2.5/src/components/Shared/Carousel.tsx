import React, { useRef, useState, useEffect, useCallback } from "react";
import { Box, IconButton, useTheme, useMediaQuery } from "@mui/material";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "./Icon";

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
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(true);
    const [isPaused, setIsPaused] = useState(false);

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
                    // Reset to beginning
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
            const scrollAmount = (itemWidth + gap) * 2;
            scrollRef.current.scrollBy({
                left: direction === "left" ? -scrollAmount : scrollAmount,
                behavior: "smooth",
            });
        }
    };

    const childArray = React.Children.toArray(children);

    return (
        <Box
            sx={{ position: "relative" }}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
        >
            {/* Left Arrow */}
            {showArrows && !isMobile && canScrollLeft && (
                <IconButton
                    onClick={() => scroll("left")}
                    sx={{
                        position: "absolute",
                        left: -20,
                        top: "50%",
                        transform: "translateY(-50%)",
                        zIndex: 10,
                        bgcolor: "rgba(0, 0, 0, 0.6)",
                        color: "white",
                        "&:hover": {
                            bgcolor: "rgba(0, 0, 0, 0.8)",
                        },
                        width: 40,
                        height: 40,
                    }}
                >
                    <Icon icon={faChevronLeft} />
                </IconButton>
            )}

            {/* Scrollable Container */}
            <Box
                ref={scrollRef}
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
                }}
            >
                {childArray.map((child, index) => (
                    <Box
                        key={index}
                        sx={{
                            flexShrink: 0,
                            scrollSnapAlign: "start",
                            width: isMobile ? "85vw" : `${itemWidth}px`,
                            maxWidth: isMobile ? "85vw" : `${itemWidth}px`,
                        }}
                    >
                        {child}
                    </Box>
                ))}
            </Box>

            {/* Right Arrow */}
            {showArrows && !isMobile && canScrollRight && (
                <IconButton
                    onClick={() => scroll("right")}
                    sx={{
                        position: "absolute",
                        right: -20,
                        top: "50%",
                        transform: "translateY(-50%)",
                        zIndex: 10,
                        bgcolor: "rgba(0, 0, 0, 0.6)",
                        color: "white",
                        "&:hover": {
                            bgcolor: "rgba(0, 0, 0, 0.8)",
                        },
                        width: 40,
                        height: 40,
                    }}
                >
                    <Icon icon={faChevronRight} />
                </IconButton>
            )}
        </Box>
    );
};

export default Carousel;
