/**
 * Reusable styled() components for common MUI v7 UI patterns.
 *
 * Centralises recurring sx-prop patterns as proper styled primitives:
 * - GlassBox     — frosted-glass panel (blur-12, semi-transparent bg + border)
 * - GlassBadge   — compact pill badge with blur-4 and translucent white fill
 * - OverlayGradient — full-bleed gradient overlay anchored to a card's bottom edge
 */
import Box from "@mui/material/Box";
import { alpha, styled } from "@mui/material/styles";

/**
 * Frosted-glass panel.
 *
 * Usage:
 *   <GlassBox sx={{ p: 2, borderRadius: 2 }}>…</GlassBox>
 *
 * Present in: GlobalSearch.tsx, MainNavbar.tsx (via AppBar sx),
 *             Settings context.tsx, ScenePlayerScrubber.tsx
 */
export const GlassBox = styled(Box)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
  backdropFilter: "blur(12px)",
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}));

/**
 * Compact pill badge with blur-4 translucent fill.
 * Renders as a `<span>` by default.
 *
 * Usage:
 *   <GlassBadge>{label}</GlassBadge>
 *
 * Present in: GalleryCard.tsx (performer pills), OverlayCard.tsx
 *             (resolution/duration badges).
 */
export const GlassBadge = styled(Box)(({ theme }) => ({
  alignItems: "center",
  backdropFilter: "blur(4px)",
  background: alpha(theme.palette.common.white, 0.2),
  borderRadius: "12px",
  color: theme.palette.common.white,
  display: "inline-flex",
  fontSize: "0.75rem",
  fontWeight: 600,
  gap: "4px",
  padding: "2px 8px",
  transition: "background 0.15s ease",
  "&:hover": {
    background: alpha(theme.palette.common.white, 0.3),
  },
})) as typeof Box;

/**
 * Full-width gradient overlay anchored to the bottom of an image container.
 * The parent element must have `position: relative` and `overflow: hidden`.
 *
 * Usage:
 *   <Box sx={{ position: "relative", overflow: "hidden" }}>
 *     <img … />
 *     <OverlayGradient>…content…</OverlayGradient>
 *   </Box>
 *
 * Present in: GroupCard.tsx, SceneCard.tsx overlay content
 */
export const OverlayGradient = styled(Box)({
  background:
    "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)",
  bottom: 0,
  color: "#fff",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  left: 0,
  padding: "12px",
  pointerEvents: "none",
  position: "absolute",
  right: 0,
  transition: "background 0.3s ease",
});
