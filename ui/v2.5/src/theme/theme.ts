import { createTheme, alpha, responsiveFontSizes } from "@mui/material/styles";

// Unified color palette - synced with index.css CSS variables
// Using a balanced dark theme with better button visibility
const colors = {
    // Zinc scale for neutrals
    zinc: {
        50: "#fafafa",
        100: "#f4f4f5",
        200: "#e4e4e7",
        300: "#d4d4d8",
        400: "#a1a1aa",
        500: "#71717a",
        600: "#52525b",
        700: "#3f3f46",
        800: "#27272a",
        900: "#18181b",
        950: "#09090b",
    },
    // Accent colors for actions - more visible on dark backgrounds
    accent: {
        primary: "#6366f1",      // Indigo-500 - vibrant primary action
        primaryHover: "#818cf8", // Indigo-400 - lighter on hover
        primaryDark: "#4f46e5",  // Indigo-600 - pressed state
        secondary: "#3f3f46",    // Zinc-700 - subtle secondary
        secondaryHover: "#52525b", // Zinc-600 - hover
    },
    // Semantic colors
    success: "#22c55e",  // Green-500
    warning: "#f59e0b",  // Amber-500
    error: "#ef4444",    // Red-500
    info: "#3b82f6",     // Blue-500
};

// Shared transition definitions for consistent animation feel
const transitions = {
    // Fast for micro-interactions (hover states, focus)
    fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
    // Normal for most transitions
    normal: "250ms cubic-bezier(0.4, 0, 0.2, 1)",
    // Slow for emphasis (modals, drawers)
    slow: "350ms cubic-bezier(0.4, 0, 0.2, 1)",
    // Spring for playful interactions
    spring: "300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
};

// Shared shadow definitions
const shadows = {
    glow: `0 0 20px ${alpha(colors.accent.primary, 0.3)}`,
    glowStrong: `0 0 30px ${alpha(colors.accent.primary, 0.5)}`,
    card: `0 4px 6px -1px ${alpha("#000", 0.1)}, 0 2px 4px -2px ${alpha("#000", 0.1)}`,
    cardHover: `0 20px 25px -5px ${alpha("#000", 0.2)}, 0 8px 10px -6px ${alpha("#000", 0.2)}`,
    elevated: `0 10px 15px -3px ${alpha("#000", 0.1)}, 0 4px 6px -4px ${alpha("#000", 0.1)}`,
};

const baseTheme = createTheme({
    // Align MUI breakpoints with Bootstrap for consistent responsive behavior
    breakpoints: {
        values: {
            xs: 0,
            sm: 576,
            md: 768,
            lg: 992,
            xl: 1200,
        },
    },
    // Enhanced typography with responsive scaling
    typography: {
        fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
        // Responsive headings - will be auto-scaled by responsiveFontSizes
        h1: {
            fontWeight: 700,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
        },
        h2: {
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
        },
        h3: {
            fontWeight: 600,
            letterSpacing: "-0.015em",
            lineHeight: 1.3,
        },
        h4: {
            fontWeight: 600,
            letterSpacing: "-0.01em",
            lineHeight: 1.35,
        },
        h5: {
            fontWeight: 500,
            lineHeight: 1.4,
        },
        h6: {
            fontWeight: 500,
            lineHeight: 1.4,
        },
        subtitle1: {
            fontWeight: 500,
            lineHeight: 1.5,
        },
        subtitle2: {
            fontWeight: 500,
            lineHeight: 1.5,
        },
        body1: {
            lineHeight: 1.6,
        },
        body2: {
            lineHeight: 1.6,
        },
        button: {
            fontWeight: 500,
            textTransform: "none" as const,
            letterSpacing: "0.01em",
        },
        caption: {
            lineHeight: 1.5,
        },
        overline: {
            letterSpacing: "0.08em",
            fontWeight: 600,
        },
    },
    // Custom shape for rounded corners
    shape: {
        borderRadius: 8,
    },
    palette: {
        mode: "dark",
        primary: {
            main: colors.accent.primary,
            light: colors.accent.primaryHover,
            dark: colors.accent.primaryDark,
            contrastText: "#ffffff",
        },
        secondary: {
            main: colors.accent.secondary,
            light: colors.accent.secondaryHover,
            dark: colors.zinc[800],
            contrastText: colors.zinc[50],
        },
        error: {
            main: colors.error,
            contrastText: "#ffffff",
        },
        warning: {
            main: colors.warning,
            contrastText: "#000000",
        },
        info: {
            main: colors.info,
            contrastText: "#ffffff",
        },
        success: {
            main: colors.success,
            contrastText: "#ffffff",
        },
        background: {
            default: colors.zinc[950], // Body background
            paper: colors.zinc[900],   // Card/paper background
        },
        text: {
            primary: colors.zinc[50],
            secondary: colors.zinc[400],
        },
        divider: colors.zinc[700],
        action: {
            active: colors.zinc[400],
            hover: "rgba(255, 255, 255, 0.08)",
            selected: "rgba(99, 102, 241, 0.16)", // primary with opacity
            disabled: colors.zinc[600],
            disabledBackground: colors.zinc[800],
        },
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                // Global smooth scrolling
                html: {
                    scrollBehavior: "smooth",
                },
                body: {
                    backgroundColor: colors.zinc[950],
                    color: colors.zinc[50],
                    // Improved text rendering
                    WebkitFontSmoothing: "antialiased",
                    MozOsxFontSmoothing: "grayscale",
                    textRendering: "optimizeLegibility",
                },
                // Custom scrollbar styling
                "*::-webkit-scrollbar": {
                    width: "8px",
                    height: "8px",
                },
                "*::-webkit-scrollbar-track": {
                    background: colors.zinc[900],
                },
                "*::-webkit-scrollbar-thumb": {
                    background: colors.zinc[700],
                    borderRadius: "4px",
                    "&:hover": {
                        background: colors.zinc[600],
                    },
                },
                // Selection styling
                "::selection": {
                    backgroundColor: alpha(colors.accent.primary, 0.3),
                    color: colors.zinc[50],
                },
                // Focus visible for accessibility
                ":focus-visible": {
                    outline: `2px solid ${colors.accent.primary}`,
                    outlineOffset: "2px",
                },
                ".btn.active:not(.disabled), .btn.active.minimal:not(.disabled)": {
                    backgroundColor: "rgba(99, 102, 241, 0.3)",
                    color: colors.zinc[50],
                },
                "a.minimal, button.minimal": {
                    background: "none",
                    border: "none",
                    color: colors.zinc[50],
                    transition: transitions.fast,
                    "&:disabled": {
                        background: "none",
                        opacity: 0.5,
                    },
                    "&:hover:not(:disabled)": {
                        background: "rgba(99, 102, 241, 0.15)",
                        color: colors.zinc[50],
                    },
                    "&:active:not(:disabled)": {
                        background: "rgba(99, 102, 241, 0.3)",
                        color: colors.zinc[50],
                    },
                },
                ".form-group h6[title]:not([title='']), .form-group label[title]:not([title=''])": {
                    cursor: "help",
                    textDecoration: "underline dotted",
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundImage: "none",
                    backgroundColor: colors.zinc[900],
                    border: "none",
                    margin: "5px",
                    overflow: "hidden",
                    transition: `transform ${transitions.normal}, box-shadow ${transitions.normal}`,
                    "&:hover": {
                        boxShadow: shadows.cardHover,
                    },
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: "none",
                },
                elevation1: {
                    boxShadow: shadows.card,
                },
                elevation2: {
                    boxShadow: shadows.elevated,
                },
            },
        },
        MuiTable: {
            styleOverrides: {
                root: {
                    border: "none",
                    color: colors.zinc[50],
                },
            },
        },
        MuiTableCell: {
            styleOverrides: {
                root: {
                    borderBottom: `1px solid ${colors.zinc[700]}`,
                    borderColor: colors.zinc[700],
                },
                head: {
                    borderBottom: `1px solid ${colors.zinc[700]}`,
                    borderRight: "none",
                    borderTop: "none",
                    fontWeight: 600,
                },
            },
        },
        MuiTableRow: {
            styleOverrides: {
                root: {
                    transition: `background-color ${transitions.fast}`,
                    "&:nth-of-type(odd)": {
                        backgroundColor: "rgba(99, 102, 241, 0.03)",
                    },
                    "&:hover": {
                        backgroundColor: "rgba(99, 102, 241, 0.08)",
                    },
                },
            },
        },
        MuiButton: {
            defaultProps: {
                disableElevation: true,
            },
            styleOverrides: {
                root: {
                    textTransform: "none",
                    fontWeight: 500,
                    borderRadius: "6px",
                    transition: `all ${transitions.fast}`,
                },
                contained: {
                    boxShadow: "none",
                    "&:hover": {
                        boxShadow: "none",
                    },
                },
                containedPrimary: {
                    backgroundColor: colors.accent.primary,
                    color: "#ffffff",
                    "&:hover": {
                        backgroundColor: colors.accent.primaryHover,
                    },
                    "&:active": {
                        backgroundColor: colors.accent.primaryDark,
                    },
                },
                containedSecondary: {
                    backgroundColor: colors.zinc[700],
                    color: colors.zinc[50],
                    "&:hover": {
                        backgroundColor: colors.zinc[600],
                    },
                },
                outlinedPrimary: {
                    borderColor: colors.accent.primary,
                    color: colors.accent.primary,
                    "&:hover": {
                        backgroundColor: "rgba(99, 102, 241, 0.08)",
                        borderColor: colors.accent.primaryHover,
                    },
                },
                outlinedSecondary: {
                    borderColor: colors.zinc[600],
                    color: colors.zinc[300],
                    "&:hover": {
                        backgroundColor: "rgba(255, 255, 255, 0.05)",
                        borderColor: colors.zinc[500],
                    },
                },
                textPrimary: {
                    color: colors.accent.primary,
                    "&:hover": {
                        backgroundColor: "rgba(99, 102, 241, 0.08)",
                    },
                },
            },
        },
        MuiIconButton: {
            styleOverrides: {
                root: {
                    color: colors.zinc[400],
                    transition: `all ${transitions.fast}`,
                    "&:hover": {
                        backgroundColor: "rgba(255, 255, 255, 0.08)",
                        color: colors.zinc[50],
                        transform: "scale(1.05)",
                    },
                    "&:active": {
                        transform: "scale(0.95)",
                    },
                },
                colorPrimary: {
                    color: colors.accent.primary,
                    "&:hover": {
                        backgroundColor: "rgba(99, 102, 241, 0.12)",
                        boxShadow: shadows.glow,
                    },
                },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    backgroundColor: colors.zinc[800],
                    color: colors.zinc[200],
                    transition: `all ${transitions.fast}`,
                    "&:hover": {
                        backgroundColor: colors.zinc[700],
                    },
                },
                colorPrimary: {
                    backgroundColor: alpha(colors.accent.primary, 0.15),
                    color: colors.accent.primaryHover,
                    border: `1px solid ${alpha(colors.accent.primary, 0.3)}`,
                    "&:hover": {
                        backgroundColor: alpha(colors.accent.primary, 0.25),
                    },
                },
                clickable: {
                    "&:hover": {
                        transform: "translateY(-1px)",
                    },
                    "&:active": {
                        transform: "translateY(0)",
                    },
                },
            },
        },
        MuiModal: {
            styleOverrides: {
                root: {
                    color: colors.zinc[50],
                },
                backdrop: {
                    backgroundColor: alpha("#000", 0.75),
                    backdropFilter: "blur(4px)",
                },
            },
        },
        MuiDialog: {
            defaultProps: {
                TransitionProps: {
                    timeout: 300,
                },
            },
            styleOverrides: {
                paper: {
                    backgroundColor: colors.zinc[900],
                    color: colors.zinc[50],
                    backgroundImage: "none",
                    boxShadow: `0 25px 50px -12px ${alpha("#000", 0.5)}`,
                    border: `1px solid ${colors.zinc[800]}`,
                },
            },
        },
        MuiDrawer: {
            styleOverrides: {
                paper: {
                    backgroundColor: colors.zinc[900],
                    backgroundImage: "none",
                    borderRight: `1px solid ${colors.zinc[800]}`,
                },
            },
        },
        MuiTab: {
            styleOverrides: {
                root: {
                    color: colors.zinc[400],
                    border: "none",
                    transition: `all ${transitions.fast}`,
                    "&.Mui-selected": {
                        color: colors.accent.primary,
                        borderBottom: "2px solid",
                        borderColor: colors.accent.primary,
                    },
                    "&:hover": {
                        color: colors.zinc[200],
                        borderBottom: `2px solid ${colors.zinc[600]}`,
                    },
                },
            },
        },
        MuiTabs: {
            styleOverrides: {
                root: {
                    border: "none",
                    marginBottom: "1.5rem",
                },
                indicator: {
                    display: "none",
                },
                scrollButtons: {
                    color: colors.zinc[400],
                    "&.Mui-disabled": {
                        opacity: 0.3,
                    },
                },
            },
        },
        MuiPopover: {
            styleOverrides: {
                paper: {
                    backgroundColor: colors.zinc[800],
                    color: colors.zinc[50],
                    boxShadow: shadows.elevated,
                    border: `1px solid ${colors.zinc[700]}`,
                }
            }
        },
        MuiMenu: {
            styleOverrides: {
                paper: {
                    backgroundColor: colors.zinc[800],
                    backgroundImage: "none",
                    border: `1px solid ${colors.zinc[700]}`,
                },
                list: {
                    padding: "4px",
                },
            },
        },
        MuiMenuItem: {
            styleOverrides: {
                root: {
                    borderRadius: "4px",
                    margin: "2px 0",
                    transition: `all ${transitions.fast}`,
                    "&:hover": {
                        backgroundColor: alpha(colors.accent.primary, 0.1),
                    },
                    "&.Mui-selected": {
                        backgroundColor: alpha(colors.accent.primary, 0.15),
                        "&:hover": {
                            backgroundColor: alpha(colors.accent.primary, 0.2),
                        },
                    },
                },
            },
        },
        MuiTooltip: {
            defaultProps: {
                arrow: true,
                enterDelay: 300,
                leaveDelay: 100,
            },
            styleOverrides: {
                tooltip: {
                    backgroundColor: colors.zinc[800],
                    color: colors.zinc[50],
                    fontSize: "0.75rem",
                    padding: "8px 12px",
                    boxShadow: shadows.elevated,
                    border: `1px solid ${colors.zinc[700]}`,
                },
                arrow: {
                    color: colors.zinc[800],
                    "&::before": {
                        border: `1px solid ${colors.zinc[700]}`,
                    },
                },
            },
        },
        MuiSelect: {
            styleOverrides: {
                root: {
                    backgroundColor: colors.zinc[800],
                    transition: `all ${transitions.fast}`,
                },
            },
        },
        MuiOutlinedInput: {
            styleOverrides: {
                root: {
                    transition: `all ${transitions.fast}`,
                    "&:hover .MuiOutlinedInput-notchedOutline": {
                        borderColor: colors.zinc[500],
                    },
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                        borderColor: colors.accent.primary,
                        boxShadow: `0 0 0 3px ${alpha(colors.accent.primary, 0.15)}`,
                    },
                },
                notchedOutline: {
                    borderColor: colors.zinc[700],
                    transition: `all ${transitions.fast}`,
                },
            },
        },
        MuiInputLabel: {
            styleOverrides: {
                root: {
                    color: colors.zinc[400],
                    transition: `all ${transitions.fast}`,
                    "&.Mui-focused": {
                        color: colors.accent.primary,
                    },
                },
            },
        },
        MuiSwitch: {
            styleOverrides: {
                root: {
                    padding: 8,
                },
                switchBase: {
                    "&.Mui-checked": {
                        color: colors.accent.primary,
                        "& + .MuiSwitch-track": {
                            backgroundColor: colors.accent.primary,
                            opacity: 0.5,
                        },
                    },
                },
                track: {
                    borderRadius: 12,
                    backgroundColor: colors.zinc[600],
                },
                thumb: {
                    boxShadow: "none",
                },
            },
        },
        MuiSlider: {
            styleOverrides: {
                root: {
                    height: 6,
                },
                thumb: {
                    width: 16,
                    height: 16,
                    transition: `all ${transitions.fast}`,
                    "&:hover, &.Mui-focusVisible": {
                        boxShadow: shadows.glow,
                    },
                },
                track: {
                    borderRadius: 3,
                },
                rail: {
                    backgroundColor: colors.zinc[700],
                    borderRadius: 3,
                },
            },
        },
        MuiBadge: {
            styleOverrides: {
                badge: {
                    fontWeight: 600,
                    fontSize: "0.65rem",
                },
                colorPrimary: {
                    backgroundColor: colors.accent.primary,
                    boxShadow: `0 0 0 2px ${colors.zinc[900]}`,
                },
            },
        },
        MuiAvatar: {
            styleOverrides: {
                root: {
                    backgroundColor: colors.zinc[700],
                    color: colors.zinc[200],
                },
            },
        },
        MuiSkeleton: {
            defaultProps: {
                animation: "wave",
            },
            styleOverrides: {
                root: {
                    backgroundColor: colors.zinc[800],
                },
                wave: {
                    "&::after": {
                        background: `linear-gradient(90deg, transparent, ${alpha(colors.zinc[700], 0.4)}, transparent)`,
                    },
                },
            },
        },
        MuiLinearProgress: {
            styleOverrides: {
                root: {
                    borderRadius: 4,
                    backgroundColor: colors.zinc[800],
                },
                bar: {
                    borderRadius: 4,
                },
            },
        },
        MuiCircularProgress: {
            styleOverrides: {
                root: {
                    // Smooth animation
                },
            },
        },
        MuiAlert: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                },
                standardSuccess: {
                    backgroundColor: alpha(colors.success, 0.15),
                    color: colors.success,
                },
                standardError: {
                    backgroundColor: alpha(colors.error, 0.15),
                    color: colors.error,
                },
                standardWarning: {
                    backgroundColor: alpha(colors.warning, 0.15),
                    color: colors.warning,
                },
                standardInfo: {
                    backgroundColor: alpha(colors.info, 0.15),
                    color: colors.info,
                },
            },
        },
        MuiAppBar: {
            defaultProps: {
                elevation: 0,
            },
            styleOverrides: {
                root: {
                    backgroundImage: "none",
                },
            },
        },
        MuiFab: {
            styleOverrides: {
                root: {
                    boxShadow: shadows.elevated,
                    transition: `all ${transitions.normal}`,
                    "&:hover": {
                        boxShadow: shadows.cardHover,
                        transform: "scale(1.05)",
                    },
                    "&:active": {
                        transform: "scale(0.95)",
                    },
                },
                primary: {
                    "&:hover": {
                        boxShadow: shadows.glowStrong,
                    },
                },
            },
        },
        MuiSpeedDial: {
            styleOverrides: {
                fab: {
                    boxShadow: shadows.glow,
                },
            },
        },
        MuiBackdrop: {
            styleOverrides: {
                root: {
                    backgroundColor: alpha("#000", 0.7),
                },
            },
        },
        MuiDivider: {
            styleOverrides: {
                root: {
                    borderColor: colors.zinc[800],
                },
            },
        },
        MuiListItemButton: {
            styleOverrides: {
                root: {
                    borderRadius: 6,
                    transition: `all ${transitions.fast}`,
                    "&:hover": {
                        backgroundColor: alpha(colors.accent.primary, 0.08),
                    },
                    "&.Mui-selected": {
                        backgroundColor: alpha(colors.accent.primary, 0.12),
                        "&:hover": {
                            backgroundColor: alpha(colors.accent.primary, 0.16),
                        },
                    },
                },
            },
        },
        MuiListItemIcon: {
            styleOverrides: {
                root: {
                    color: colors.zinc[400],
                    minWidth: 40,
                },
            },
        },
    },
});

// Apply responsive font sizes for better mobile typography
const theme = responsiveFontSizes(baseTheme, {
    breakpoints: ["sm", "md", "lg"],
    factor: 2.5,
});

// Export theme utilities for use in components
export { colors, transitions, shadows, alpha };
export default theme;
