import { createTheme } from "@mui/material/styles";

const theme = createTheme({
    palette: {
        mode: "dark", // Default to dark mode for Stash
        primary: {
            main: "#1976d2", // Default MUI blue, will verify branding later
        },
        secondary: {
            main: "#dc004e",
        },
    },
});

export default theme;
