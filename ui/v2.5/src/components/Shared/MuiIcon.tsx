/**
 * MuiIcon - A unified icon component that provides MUI icons as alternatives to FontAwesome
 * 
 * This component maps common FontAwesome icons to their MUI equivalents.
 * Benefits of using MUI icons:
 * - Smaller bundle size (tree-shakeable)
 * - Consistent styling with MUI theme
 * - Better integration with sx prop and theme colors
 * - Fewer dependencies
 * 
 * Usage:
 *   import { MuiIcon } from "src/components/Shared/MuiIcon";
 *   <MuiIcon icon="search" />
 *   <MuiIcon icon="search" sx={{ color: "primary.main" }} />
 */

import React from "react";
import { SvgIconProps } from "@mui/material";

// MUI Icons imports - add more as needed
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import CheckIcon from "@mui/icons-material/Check";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ErrorIcon from "@mui/icons-material/Error";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FilterListIcon from "@mui/icons-material/FilterList";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import HomeIcon from "@mui/icons-material/Home";
import InfoIcon from "@mui/icons-material/Info";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import MenuIcon from "@mui/icons-material/Menu";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import SortIcon from "@mui/icons-material/Sort";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import SyncIcon from "@mui/icons-material/Sync";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import WarningIcon from "@mui/icons-material/Warning";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import PersonIcon from "@mui/icons-material/Person";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import BusinessIcon from "@mui/icons-material/Business";
import MovieIcon from "@mui/icons-material/Movie";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import DownloadIcon from "@mui/icons-material/Download";
import UploadIcon from "@mui/icons-material/Upload";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import ImageIcon from "@mui/icons-material/Image";
import VideocamIcon from "@mui/icons-material/Videocam";
import MergeIcon from "@mui/icons-material/Merge";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeMuteIcon from "@mui/icons-material/VolumeMute";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import ListIcon from "@mui/icons-material/List";
import GridViewIcon from "@mui/icons-material/GridView";
import ViewListIcon from "@mui/icons-material/ViewList";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import RepeatIcon from "@mui/icons-material/Repeat";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import FastForwardIcon from "@mui/icons-material/FastForward";
import FastRewindIcon from "@mui/icons-material/FastRewind";
import CancelIcon from "@mui/icons-material/Cancel";
import DoneIcon from "@mui/icons-material/Done";
import HelpIcon from "@mui/icons-material/Help";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";

/**
 * Icon name mapping - FontAwesome to MUI equivalents
 * 
 * FontAwesome icon names (camelCase without 'fa' prefix) -> MUI icon component
 */
const iconMap: Record<string, React.ComponentType<SvgIconProps>> = {
    // Navigation & Actions
    "plus": AddIcon,
    "add": AddIcon,
    "minus": CloseIcon, // MUI doesn't have a great minus, use Remove or custom
    "times": CloseIcon,
    "close": CloseIcon,
    "check": CheckIcon,
    "checkCircle": CheckCircleIcon,
    "checkCircleOutline": CheckCircleOutlineIcon,
    "search": SearchIcon,
    "filter": FilterListIcon,
    "filterList": FilterListIcon,
    "edit": EditIcon,
    "pencilAlt": EditIcon,
    "trash": DeleteIcon,
    "trashAlt": DeleteIcon,
    "delete": DeleteIcon,
    "save": SaveIcon,
    "copy": ContentCopyIcon,
    "clipboard": ContentCopyIcon,
    "refresh": RefreshIcon,
    "sync": SyncIcon,
    "redo": RefreshIcon,
    
    // Arrows
    "arrowLeft": ArrowBackIcon,
    "arrowRight": ArrowForwardIcon,
    "arrowUp": ArrowUpwardIcon,
    "arrowDown": ArrowDownwardIcon,
    "chevronLeft": ChevronLeftIcon,
    "chevronRight": ChevronRightIcon,
    "chevronUp": ExpandLessIcon,
    "chevronDown": ExpandMoreIcon,
    "expandLess": ExpandLessIcon,
    "expandMore": ExpandMoreIcon,
    
    // Sorting
    "sort": SortIcon,
    "sortAmountUp": ArrowUpwardIcon,
    "sortAmountDown": ArrowDownwardIcon,
    "sortAsc": ArrowUpwardIcon,
    "sortDesc": ArrowDownwardIcon,
    "swapHoriz": SwapHorizIcon,
    "swapVert": SwapVertIcon,
    "exchangeAlt": SwapHorizIcon,
    
    // Media Controls
    "play": PlayArrowIcon,
    "pause": PauseIcon,
    "volumeUp": VolumeUpIcon,
    "volumeOff": VolumeOffIcon,
    "volumeMute": VolumeMuteIcon,
    "expand": FullscreenIcon,
    "compress": FullscreenExitIcon,
    "fullscreen": FullscreenIcon,
    "fullscreenExit": FullscreenExitIcon,
    "skipNext": SkipNextIcon,
    "skipPrevious": SkipPreviousIcon,
    "fastForward": FastForwardIcon,
    "fastRewind": FastRewindIcon,
    "shuffle": ShuffleIcon,
    "repeat": RepeatIcon,
    
    // Zoom
    "zoomIn": ZoomInIcon,
    "zoomOut": ZoomOutIcon,
    "searchPlus": ZoomInIcon,
    "searchMinus": ZoomOutIcon,
    
    // UI Elements
    "bars": MenuIcon,
    "menu": MenuIcon,
    "ellipsisV": MoreVertIcon,
    "moreVert": MoreVertIcon,
    "cog": SettingsIcon,
    "settings": SettingsIcon,
    "home": HomeIcon,
    "info": InfoIcon,
    "infoCircle": InfoIcon,
    "question": HelpOutlineIcon,
    "questionCircle": HelpIcon,
    "help": HelpIcon,
    "helpOutline": HelpOutlineIcon,
    "warning": WarningIcon,
    "exclamationTriangle": WarningIcon,
    "triangleExclamation": WarningIcon,
    "error": ErrorIcon,
    "cancel": CancelIcon,
    "done": DoneIcon,
    
    // Links & External
    "link": LinkIcon,
    "unlink": LinkOffIcon,
    "linkOff": LinkOffIcon,
    "externalLink": OpenInNewIcon,
    "externalLinkAlt": OpenInNewIcon,
    "arrowUpRightFromSquare": OpenInNewIcon,
    "openInNew": OpenInNewIcon,
    
    // Favorites & Ratings
    "heart": FavoriteIcon,
    "heartOutline": FavoriteBorderIcon,
    "favorite": FavoriteIcon,
    "favoriteBorder": FavoriteBorderIcon,
    "star": StarIcon,
    "starOutline": StarBorderIcon,
    "starBorder": StarBorderIcon,
    "bookmark": BookmarkIcon,
    "bookmarkOutline": BookmarkBorderIcon,
    
    // Entity types
    "user": PersonIcon,
    "person": PersonIcon,
    "tag": LocalOfferIcon,
    "localOffer": LocalOfferIcon,
    "building": BusinessIcon,
    "business": BusinessIcon,
    "film": MovieIcon,
    "movie": MovieIcon,
    "image": ImageIcon,
    "images": PhotoLibraryIcon,
    "photoLibrary": PhotoLibraryIcon,
    "video": VideocamIcon,
    "videocam": VideocamIcon,
    
    // Files & Folders
    "folder": FolderIcon,
    "folderOpen": FolderOpenIcon,
    "folderPlus": CreateNewFolderIcon,
    "download": DownloadIcon,
    "upload": UploadIcon,
    
    // Views
    "list": ListIcon,
    "viewList": ViewListIcon,
    "grid": GridViewIcon,
    "gridView": GridViewIcon,
    "viewModule": ViewModuleIcon,
    "queue": QueueMusicIcon,
    
    // Visibility
    "eye": VisibilityIcon,
    "eyeSlash": VisibilityOffIcon,
    "visibility": VisibilityIcon,
    "visibilityOff": VisibilityOffIcon,
    
    // Misc
    "signInAlt": ArrowForwardIcon,
    "merge": MergeIcon,
    "split": CallSplitIcon,
};

export type IconName = keyof typeof iconMap;

interface MuiIconProps extends SvgIconProps {
    /**
     * Icon name - either camelCase FontAwesome name (without 'fa' prefix) or MUI name
     */
    icon: IconName | string;
}

/**
 * MuiIcon component - renders MUI icons by name
 * 
 * @example
 * // Using FontAwesome-style names (for easy migration)
 * <MuiIcon icon="search" />
 * <MuiIcon icon="trashAlt" color="error" />
 * <MuiIcon icon="plus" sx={{ fontSize: 24 }} />
 * 
 * @example
 * // With MUI-style names
 * <MuiIcon icon="settings" />
 * <MuiIcon icon="person" />
 */
export const MuiIcon: React.FC<MuiIconProps> = ({ icon, ...props }) => {
    const IconComponent = iconMap[icon];
    
    if (!IconComponent) {
        console.warn(`MuiIcon: Unknown icon "${icon}". Add it to iconMap or use FontAwesome.`);
        return <HelpOutlineIcon {...props} />;
    }
    
    return <IconComponent {...props} />;
};

/**
 * Helper to check if an icon has a MUI equivalent
 */
export const hasMuiIcon = (iconName: string): boolean => {
    return iconName in iconMap;
};

/**
 * Export individual icons for direct imports (tree-shaking friendly)
 */
export {
    AddIcon,
    ArrowBackIcon,
    ArrowForwardIcon,
    CheckIcon,
    CloseIcon,
    DeleteIcon,
    EditIcon,
    FilterListIcon,
    SearchIcon,
    SettingsIcon,
    // Add more exports as needed
};

export default MuiIcon;
