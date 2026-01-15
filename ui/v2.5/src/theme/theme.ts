import { createTheme } from "@mui/material/styles";

const theme = createTheme({
    palette: {
        mode: "dark",
        primary: {
            main: "#52525b", // Zinc-600
            light: "#71717a", // Zinc-500
            dark: "#3f3f46", // Zinc-700
            contrastText: "#fafafa",
        },
        secondary: {
            main: "#27272a", // Zinc-800
            light: "#3f3f46", // Zinc-700
            dark: "#18181b", // Zinc-900
            contrastText: "#fafafa",
        },
        error: {
            main: "#db3737",
        },
        warning: {
            main: "#d9822b",
        },
        info: {
            main: "#71717a", // Zinc-500
        },
        success: {
            main: "#0f9960",
        },
        background: {
            default: "#09090b", // Zinc-950 ($body-bg)
            paper: "#18181b",   // Zinc-900 ($card-bg)
        },
        text: {
            primary: "#fafafa", // Zinc-50 ($text-color)
            secondary: "#a1a1aa", // Zinc-400 ($text-muted)
        },
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: {
                    backgroundColor: "#09090b",
                    color: "#fafafa",
                },
                ".btn.active:not(.disabled), .btn.active.minimal:not(.disabled)": {
                    backgroundColor: "rgba(138, 155, 168, 0.3)",
                    color: "#fafafa",
                },
                "a.minimal, button.minimal": {
                    background: "none",
                    border: "none",
                    color: "#fafafa",
                    transition: "none",
                    "&:disabled": {
                        background: "none",
                        opacity: 0.5,
                    },
                    "&:hover:not(:disabled)": {
                        background: "rgba(138, 155, 168, 0.15)",
                        color: "#fafafa",
                    },
                    "&:active:not(:disabled)": {
                        background: "rgba(138, 155, 168, 0.3)",
                        color: "#fafafa",
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
                    backgroundImage: "none", // Reset default paper gradient
                    backgroundColor: "#18181b", // $card-bg
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
                    color: "#fafafa",
                },
            },
        },
        MuiTableCell: {
            styleOverrides: {
                root: {
                    borderBottom: "1px solid #414c53",
                    borderColor: "#414c53",
                },
                head: {
                    borderBottom: "1px solid #414c53",
                    borderRight: "none",
                    borderTop: "none",
                },
            },
        },
        MuiTableRow: {
            styleOverrides: {
                root: {
                    "&:nth-of-type(odd)": {
                        backgroundColor: "rgba(92, 112, 128, 0.15)", // Striped effect from _theme.scss
                    },
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    textTransform: "none", // Prevent uppercase default
                },
            },
        },
        MuiModal: {
            styleOverrides: {
                root: {
                    color: "#fafafa",
                },
            },
        },
        MuiDialog: {
            styleOverrides: {
                paper: {
                    backgroundColor: "#18181b", // $card-bg
                    color: "#fafafa",
                    backgroundImage: "none",
                },
            },
        },
        MuiTab: {
            styleOverrides: {
                root: {
                    color: "#fafafa",
                    border: "none",
                    "&.Mui-selected": {
                        color: "#e4e4e7", // $link-color
                        borderBottom: "2px solid",
                        borderColor: "#e4e4e7",
                    },
                    "&:hover": {
                        borderBottom: "2px solid white",
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
                    display: "none", // We use custom border styling on Tab
                },
            },
        },
        MuiPopover: {
            styleOverrides: {
                paper: {
                    backgroundColor: "#27272a", // $popover-bg ($secondary)
                    color: "#fafafa",
                }
            }
        }
    },
});

export default theme;
