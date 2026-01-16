import React, { useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SettingsIcon from "@mui/icons-material/Settings";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import MenuIcon from "@mui/icons-material/Menu";
import { ILightboxImage as LightboxImageType, IChapter } from "./types";
import { RatingSystem } from "src/components/Shared/Rating/RatingSystem";
import { OCounterButton } from "src/components/Scenes/SceneDetails/OCounterButton";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { imageLightboxDisplayModeIntlMap } from "src/core/enums";

interface LightboxControlsProps {
    visible: boolean;
    image?: LightboxImageType;
    currentIndex: number;
    totalImages: number;
    onClose: () => void;
    isFullscreen: boolean;
    onToggleFullscreen: () => void;
    showOptions: boolean;
    onToggleOptions: () => void;
    chapters: IChapter[];
    onChapterClick: (index: number) => void;
    slideshowEnabled: boolean;
    slideshowActive: boolean;
    onToggleSlideshow: () => void;
    zoom: number;
    onZoomChange: (zoom: number) => void;
    onRatingChange: (v: number | null) => void;
    onIncrementO: () => Promise<void>;
    onDecrementO: () => Promise<void>;
    title?: string;
    details?: React.ReactNode;
    date?: string;
    optionsContent?: React.ReactNode;
}

const ControlButton: React.FC<{
    onClick: () => void;
    title?: string;
    active?: boolean;
    children: React.ReactNode;
}> = ({ onClick, title, active, children }) => (
    <button
        className={`p-3 rounded-full hover:bg-white/20 transition-colors text-white ${active ? "text-blue-400" : ""
            }`}
        onClick={(e) => {
            e.stopPropagation();
            onClick();
        }}
        title={title}
    >
        {children}
    </button>
);

export const LightboxControls: React.FC<LightboxControlsProps> = ({
    visible,
    image,
    currentIndex,
    totalImages,
    onClose,
    isFullscreen,
    onToggleFullscreen,
    showOptions,
    onToggleOptions,
    chapters,
    onChapterClick,
    slideshowEnabled,
    slideshowActive,
    onToggleSlideshow,
    zoom,
    onZoomChange,
    onRatingChange,
    onIncrementO,
    onDecrementO,
    title,
    details,
    date,
    optionsContent,
}) => {
    const intl = useIntl();
    const [showChapters, setShowChapters] = useState(false);

    if (!visible) return null;

    return (
        <>
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-start z-[2000] transition-opacity duration-300">
                <div className="flex flex-col gap-1">
                    {chapters.length > 0 && (
                        <div className="relative">
                            <button
                                className="flex items-center gap-2 text-white/80 hover:text-white mb-2"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowChapters(!showChapters);
                                }}
                            >
                                <MenuIcon sx={{ fontSize: '2rem' }} />
                                <span className="text-xl">Chapters</span>
                                <KeyboardArrowDownIcon sx={{ fontSize: '2rem' }} />
                            </button>

                            {showChapters && (
                                <div className="absolute top-full left-0 mt-2 bg-gray-900 border border-gray-700 rounded-md shadow-xl py-1 w-64 max-h-96 overflow-y-auto z-[2010]">
                                    {chapters.map((chapter) => (
                                        <button
                                            key={chapter.id}
                                            className="w-full text-left px-4 py-2 hover:bg-white/10 text-lg text-gray-200"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onChapterClick(chapter.image_index);
                                                setShowChapters(false);
                                            }}
                                        >
                                            <span className="font-bold mr-2">#{chapter.image_index}</span>
                                            {chapter.title}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <h2 className="text-xl font-bold text-white drop-shadow-md">{title}</h2>
                    {details && (
                        <div className="text-base text-gray-300 drop-shadow-md">
                            {details} {date && `• ${date}`}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {zoom !== 1 && (
                        <ControlButton onClick={() => onZoomChange(1)} title="Reset Zoom">
                            <ZoomOutIcon sx={{ fontSize: '2rem' }} />
                        </ControlButton>
                    )}

                    {slideshowEnabled && (
                        <ControlButton
                            onClick={onToggleSlideshow}
                            active={slideshowActive}
                            title="Toggle Slideshow"
                        >
                            {slideshowActive ? <PauseIcon sx={{ fontSize: '2rem' }} /> : <PlayArrowIcon sx={{ fontSize: '2rem' }} />}
                        </ControlButton>
                    )}

                    <div className="relative">
                        <ControlButton onClick={onToggleOptions} title="Options" active={showOptions}>
                            <SettingsIcon sx={{ fontSize: '2rem' }} />
                        </ControlButton>

                        {showOptions && (
                            <div
                                className="absolute top-full right-0 mt-2 bg-gray-900 border border-gray-700 rounded-md shadow-xl p-4 min-w-[350px] z-[2010] text-left"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="space-y-4">
                                    {optionsContent}
                                </div>
                            </div>
                        )}
                    </div>

                    <ControlButton onClick={onToggleFullscreen} title="Toggle Fullscreen">
                        <FullscreenIcon sx={{ fontSize: '2rem' }} />
                    </ControlButton>

                    <ControlButton onClick={onClose} title="Close">
                        <CloseIcon sx={{ fontSize: '2rem' }} />
                    </ControlButton>
                </div>
            </div>

            {/* Footer */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex justify-between items-end z-[2000] transition-opacity duration-300">
                <div className="flex gap-4 items-center">
                    <div className="flex items-center gap-2 text-white">
                        <span className="text-lg opacity-70">
                            {currentIndex + 1} / {totalImages}
                        </span>
                    </div>

                    <div className="h-8 w-px bg-white/20 mx-2"></div>

                    <OCounterButton
                        value={image?.o_counter ?? 0}
                        onIncrement={onIncrementO}
                        onDecrement={onDecrementO}
                        onReset={async () => { }}
                    />

                    <RatingSystem
                        value={image?.rating100}
                        onSetRating={onRatingChange}
                        clickToRate
                        withoutContext
                    />
                </div>
            </div>
        </>
    );
};
