import React, { useEffect, useRef } from "react";
import cx from "classnames";
import { ILightboxImage } from "./types";

interface ILightboxFilmstripProps {
    visible: boolean;
    images: ILightboxImage[];
    currentIndex: number;
    onSelect: (index: number) => void;
}

export const LightboxFilmstrip: React.FC<ILightboxFilmstripProps> = ({
    visible,
    images,
    currentIndex,
    onSelect,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedRef = useRef<HTMLButtonElement>(null);

    // Auto-scroll to selected item
    useEffect(() => {
        if (visible && selectedRef.current && containerRef.current) {
            selectedRef.current.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "center",
            });
        }
    }, [currentIndex, visible]);

    if (!visible) return null;

    return (
        <div
            className={cx(
                "fixed bottom-24 left-1/2 -translate-x-1/2 z-[1050] w-full max-w-5xl px-4 transition-all duration-300",
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
            )}
        >
            <div
                ref={containerRef}
                className="flex gap-2 overflow-x-auto p-2 bg-black/60 backdrop-blur-md rounded-xl border border-white/5 shadow-2xl scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
                style={{ scrollBehavior: "smooth" }}
            >
                {images.map((image, index) => {
                    const isSelected = index === currentIndex;
                    const source =
                        image.paths.preview != ""
                            ? image.paths.preview ?? ""
                            : image.paths.thumbnail ?? "";
                    const isVideo = image.paths.preview != "";

                    return (
                        <button
                            key={image.id || index}
                            ref={isSelected ? selectedRef : null}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect(index);
                            }}
                            className={cx(
                                "relative flex-shrink-0 h-16 aspect-[2/3] rounded-md overflow-hidden transition-all duration-200 focus:outline-none ring-2",
                                isSelected
                                    ? "ring-primary scale-105 z-10 opacity-100"
                                    : "ring-transparent opacity-60 hover:opacity-100 hover:scale-105"
                            )}
                        >
                            {isVideo ? (
                                <video
                                    src={source}
                                    className="w-full h-full object-cover"
                                    autoPlay={false}
                                    muted
                                    loop
                                    playsInline
                                />
                            ) : (
                                <img
                                    src={source}
                                    alt={image.title || ""}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
