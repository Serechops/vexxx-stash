import { createTheme } from "@mui/material/styles";

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

const theme = createTheme({
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
                body: {
                    backgroundColor: colors.zinc[950],
                    color: colors.zinc[50],
                },
                ".btn.active:not(.disabled), .btn.active.minimal:not(.disabled)": {
                    backgroundColor: "rgba(99, 102, 241, 0.3)",
                    color: colors.zinc[50],
                },
                "a.minimal, button.minimal": {
                    background: "none",
                    border: "none",
                    color: colors.zinc[50],
                    transition: "none",
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
                },
            },
        },
        MuiTableRow: {
            styleOverrides: {
                root: {
                    "&:nth-of-type(odd)": {
                        backgroundColor: "rgba(99, 102, 241, 0.05)", // Subtle primary tint
                    },
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    textTransform: "none",
                    fontWeight: 500,
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
                    "&:hover": {
                        backgroundColor: "rgba(255, 255, 255, 0.08)",
                        color: colors.zinc[50],
                    },
                },
                colorPrimary: {
                    color: colors.accent.primary,
                    "&:hover": {
                        backgroundColor: "rgba(99, 102, 241, 0.08)",
                    },
                },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    backgroundColor: colors.zinc[800],
                    color: colors.zinc[200],
                },
                colorPrimary: {
                    backgroundColor: "rgba(99, 102, 241, 0.2)",
                    color: colors.accent.primaryHover,
                },
            },
        },
        MuiModal: {
            styleOverrides: {
                root: {
                    color: colors.zinc[50],
                },
            },
        },
        MuiDialog: {
            styleOverrides: {
                paper: {
                    backgroundColor: colors.zinc[900],
                    color: colors.zinc[50],
                    backgroundImage: "none",
                },
            },
        },
        MuiTab: {
            styleOverrides: {
                root: {
                    color: colors.zinc[400],
                    border: "none",
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
            },
        },
        MuiPopover: {
            styleOverrides: {
                paper: {
                    backgroundColor: colors.zinc[800],
                    color: colors.zinc[50],
                }
            }
        },
        MuiTooltip: {
            styleOverrides: {
                tooltip: {
                    backgroundColor: colors.zinc[800],
                    color: colors.zinc[50],
                    fontSize: "0.75rem",
                },
            },
        },
        MuiSelect: {
            styleOverrides: {
                root: {
                    backgroundColor: colors.zinc[800],
                },
            },
        },
        MuiOutlinedInput: {
            styleOverrides: {
                root: {
                    "&:hover .MuiOutlinedInput-notchedOutline": {
                        borderColor: colors.zinc[500],
                    },
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                        borderColor: colors.accent.primary,
                    },
                },
                notchedOutline: {
                    borderColor: colors.zinc[700],
                },
            },
        },
        MuiInputLabel: {
            styleOverrides: {
                root: {
                    color: colors.zinc[400],
                    "&.Mui-focused": {
                        color: colors.accent.primary,
                    },
                },
            },
        },
    },
});

export default theme;
