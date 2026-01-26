/**
 * Theme utilities and hooks for consistent MUI v7 styling
 * Provides reusable patterns for responsive design and common UI patterns
 */
import { useTheme, useMediaQuery, alpha } from "@mui/material";
import { useMemo } from "react";

/**
 * Hook to detect current breakpoint
 * Returns boolean flags for each breakpoint range
 */
export function useBreakpoints() {
  const theme = useTheme();
  
  return {
    isXs: useMediaQuery(theme.breakpoints.only("xs")),
    isSm: useMediaQuery(theme.breakpoints.only("sm")),
    isMd: useMediaQuery(theme.breakpoints.only("md")),
    isLg: useMediaQuery(theme.breakpoints.only("lg")),
    isXl: useMediaQuery(theme.breakpoints.only("xl")),
    // Convenience aliases
    isMobile: useMediaQuery(theme.breakpoints.down("sm")),
    isTablet: useMediaQuery(theme.breakpoints.between("sm", "md")),
    isDesktop: useMediaQuery(theme.breakpoints.up("md")),
    isLargeDesktop: useMediaQuery(theme.breakpoints.up("lg")),
  };
}

/**
 * Hook for touch device detection
 */
export function useTouchDevice() {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }, []);
}

/**
 * Common sx prop patterns for reuse across components
 */
export const sxPatterns = {
  // Glassmorphism effect
  glass: {
    bgcolor: (t: any) => alpha(t.palette.background.paper, 0.8),
    backdropFilter: "blur(12px)",
    border: 1,
    borderColor: (t: any) => alpha(t.palette.divider, 0.1),
  },
  
  // Card hover effect
  cardHover: {
    transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
    "&:hover": {
      transform: "translateY(-4px)",
      boxShadow: (t: any) => `0 20px 40px ${alpha("#000", 0.2)}`,
    },
  },
  
  // Subtle glow on focus/hover
  glowOnHover: (color: string) => ({
    transition: "box-shadow 0.2s ease",
    "&:hover, &:focus": {
      boxShadow: `0 0 20px ${alpha(color, 0.3)}`,
    },
  }),
  
  // Truncate text with ellipsis
  truncate: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  
  // Multi-line truncate (clamp)
  lineClamp: (lines: number) => ({
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  }),
  
  // Center content
  center: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  
  // Full bleed container (break out of parent padding)
  fullBleed: {
    width: "100vw",
    marginLeft: "calc(50% - 50vw)",
    marginRight: "calc(50% - 50vw)",
  },
  
  // Hide scrollbar but keep scrolling
  hideScrollbar: {
    scrollbarWidth: "none",
    msOverflowStyle: "none",
    "&::-webkit-scrollbar": {
      display: "none",
    },
  },
  
  // Smooth momentum scrolling for iOS
  smoothScroll: {
    WebkitOverflowScrolling: "touch",
    overflowY: "auto",
  },
  
  // Interactive element base styling
  interactive: {
    cursor: "pointer",
    userSelect: "none",
    transition: "all 0.15s ease",
    "&:active": {
      transform: "scale(0.98)",
    },
  },
};

/**
 * Responsive value helper
 * Creates responsive sx values based on breakpoints
 */
export function responsive<T>(values: {
  xs?: T;
  sm?: T;
  md?: T;
  lg?: T;
  xl?: T;
}): Record<string, T> {
  return values as Record<string, T>;
}

/**
 * Animation keyframes for common patterns
 */
export const animations = {
  fadeIn: {
    "@keyframes fadeIn": {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
    animation: "fadeIn 0.3s ease-out",
  },
  
  slideUp: {
    "@keyframes slideUp": {
      from: { 
        opacity: 0, 
        transform: "translateY(10px)" 
      },
      to: { 
        opacity: 1, 
        transform: "translateY(0)" 
      },
    },
    animation: "slideUp 0.3s ease-out",
  },
  
  pulse: {
    "@keyframes pulse": {
      "0%, 100%": { opacity: 1 },
      "50%": { opacity: 0.5 },
    },
    animation: "pulse 2s ease-in-out infinite",
  },
  
  shimmer: {
    "@keyframes shimmer": {
      "0%": { backgroundPosition: "-200% 0" },
      "100%": { backgroundPosition: "200% 0" },
    },
    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s ease-in-out infinite",
  },
};

/**
 * Spacing utilities following MUI's 8px grid
 */
export const spacing = {
  xs: 0.5,  // 4px
  sm: 1,    // 8px
  md: 2,    // 16px
  lg: 3,    // 24px
  xl: 4,    // 32px
  xxl: 6,   // 48px
};

/**
 * Z-index layers for consistent stacking
 */
export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  fixed: 300,
  overlay: 400,
  modal: 500,
  popover: 600,
  tooltip: 700,
  toast: 800,
  max: 9999,
};

export default {
  useBreakpoints,
  useTouchDevice,
  sxPatterns,
  responsive,
  animations,
  spacing,
  zIndex,
};
