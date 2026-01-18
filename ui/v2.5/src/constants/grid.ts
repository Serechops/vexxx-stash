/**
 * Shared grid constants for card layouts
 * Used across all CardGrid components for consistent sizing
 */

// Standard zoom widths for card grids (in pixels)
// Index 0 = most zoomed out (smallest), Index 4 = most zoomed in (largest)
export const CARD_ZOOM_WIDTHS: number[] = [280, 340, 420, 560, 800];

// Default zoom index (middle value)
export const DEFAULT_ZOOM_INDEX = 2;

// Grid gap values (in rem)
export const GRID_GAP = "1rem";
export const GRID_GAP_LARGE = "1.5rem";

// Card aspect ratios
export const ASPECT_RATIO_SCENE = "16/9";
export const ASPECT_RATIO_PERFORMER = "2/3";
export const ASPECT_RATIO_GALLERY = "4/3";
