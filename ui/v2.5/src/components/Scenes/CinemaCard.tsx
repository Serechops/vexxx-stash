
import React, { useMemo, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { objectTitle } from "src/core/files";
import { SceneQueue } from "src/models/sceneQueue";
import { useConfigurationContext } from "src/hooks/Config";
import { HoverVideoPreview } from "./HoverVideoPreview";
import { ResumeProgressBar } from "./ResumeProgressBar";
import TextUtils from "src/utils/text";
import { Play } from "lucide-react";
import { apihubEntityLink } from "./apihubEntityLink";

// ─── Card prop interface (mirrors existing card contracts) ───────────────────

interface ISceneCardProps {
    scene: GQL.SlimSceneDataFragment;
    width?: number;
    index?: number;
    queue?: SceneQueue;
    selecting?: boolean;
    selected?: boolean;
    zoomIndex?: number;
    onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
    link?: string;
    extraActions?: React.ReactNode;
}

// ─── One-time style injection ────────────────────────────────────────────────

const CINEMA_STYLES = `
@keyframes cinemaPan {
    0%   { transform: scale(1.04) translate(0%, 0%); }
    30%  { transform: scale(1.07) translate(-1.2%, -0.6%); }
    60%  { transform: scale(1.05) translate(0.8%, 0.9%); }
    100% { transform: scale(1.06) translate(-0.4%, -0.2%); }
}
.cinema-card .scene-card-preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: cinemaPan 20s ease-in-out infinite alternate;
    will-change: transform;
}
.cinema-card:hover .scene-card-preview-image {
    animation-play-state: paused;
    transform: scale(1.07);
    transition: transform 0.7s cubic-bezier(0.4, 0, 0.2, 1);
}
.cinema-card {
    transition: box-shadow 0.3s ease, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.cinema-card:hover {
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.09),
        0 0 32px rgba(251, 191, 36, 0.06),
        0 14px 48px rgba(0, 0, 0, 0.65);
    transform: translateY(-3px);
}
.cinema-play-btn {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.75);
    transition: opacity 0.2s ease, transform 0.2s ease;
    pointer-events: none;
}
.cinema-card:hover .cinema-play-btn {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
}
.cinema-performer-names {
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.2s ease, transform 0.2s ease;
}
.cinema-card:hover .cinema-performer-names {
    opacity: 1;
    transform: translateY(0);
}
.cinema-select-overlay {
    opacity: 0;
    transition: opacity 0.2s ease;
}
.cinema-select-overlay.is-active {
    opacity: 1;
}
.cinema-card:hover .cinema-select-overlay {
    opacity: 1;
}
`;

let _stylesInjected = false;
function ensureStyles() {
    if (_stylesInjected || typeof document === "undefined") return;
    _stylesInjected = true;
    const el = document.createElement("style");
    el.id = "cinema-card-styles";
    el.textContent = CINEMA_STYLES;
    document.head.appendChild(el);
}

// ─── Rating dots ─────────────────────────────────────────────────────────────

const RatingDots: React.FC<{ rating100: number }> = ({ rating100 }) => {
    const filled = Math.round(rating100 / 20);
    return (
        <div className="flex items-center gap-[3px] flex-shrink-0">
            {Array.from({ length: 5 }).map((_, i) => (
                <span
                    key={i}
                    className="block rounded-full"
                    style={{
                        width: 5,
                        height: 5,
                        background: i < filled ? "#fbbf24" : "rgba(255,255,255,0.14)",
                        boxShadow: i < filled ? "0 0 5px rgba(251,191,36,0.65)" : "none",
                    }}
                />
            ))}
        </div>
    );
};

// ─── Main component ──────────────────────────────────────────────────────────

export const CinemaCard: React.FC<ISceneCardProps> = ({
    scene,
    index,
    queue,
    selecting,
    selected,
    onSelectedChanged,
    link,
    extraActions,
}) => {
    ensureStyles();

    const [isHovered, setIsHovered] = useState(false);
    const { configuration } = useConfigurationContext();
    const history = useHistory();

    const file = useMemo(() => scene.files[0] ?? undefined, [scene]);
    const duration = file?.duration != null ? TextUtils.secondsToTimestamp(file.duration) : null;
    const resolution = file?.width && file?.height ? TextUtils.resolution(file.width, file.height) : null;
    const title = objectTitle(scene);
    const performers = scene.performers?.slice(0, 5) ?? [];

    const sceneLink = useMemo(() => {
        if (link) return link;
        if (queue) return queue.makeLink(scene.id, { sceneIndex: index ?? 0, autoPlay: false });
        return `/scenes/${scene.id}`;
    }, [link, queue, scene.id, index]);

    const isExternal = !!link && !link.startsWith("/");

    const linkProps = {
        style: {
            textDecoration: "none",
            color: "inherit",
            display: "flex",
            flexDirection: "column" as const,
            height: "100%",
        },
    };

    const inner = (
        <>
            {/* ── Thumbnail ─────────────────────────────────── */}
            <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}>
                <HoverVideoPreview
                    image={scene.paths.screenshot ?? undefined}
                    video={scene.paths.preview ?? undefined}
                    isHovered={isHovered}
                    soundActive={configuration?.interface?.soundOnPreview ?? false}
                    isPortrait={false}
                    vttPath={scene.paths.vtt ?? undefined}
                    vrMode={scene.vr_mode}
                />

                {/* Gradient blending thumb into card body */}
                <div
                    className="absolute inset-x-0 bottom-0 h-24 pointer-events-none z-[1]"
                    style={{ background: "linear-gradient(to top, #0d0d0f 0%, rgba(13,13,15,0.4) 60%, transparent 100%)" }}
                />

                {/* Play button */}
                <div
                    className="cinema-play-btn absolute left-1/2 top-[45%] z-10 flex items-center justify-center rounded-full"
                    style={{
                        width: 50,
                        height: 50,
                        background: "rgba(255,255,255,0.11)",
                        backdropFilter: "blur(10px)",
                        border: "1.5px solid rgba(255,255,255,0.32)",
                        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                    }}
                >
                    <Play
                        className="text-white fill-white"
                        style={{ width: 16, height: 16, marginLeft: 2 }}
                        strokeWidth={0}
                    />
                </div>

                {/* Duration — bottom right */}
                {duration && (
                    <div
                        className="absolute bottom-2 right-2 z-[2] text-white text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
                    >
                        {duration}
                    </div>
                )}

                {/* Resolution — bottom left */}
                {resolution && (
                    <div
                        className="absolute bottom-2 left-2 z-[2] text-white/55 text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
                    >
                        {resolution}
                    </div>
                )}

                {/* Resume progress */}
                <ResumeProgressBar
                    resumeTime={scene.resume_time}
                    duration={file?.duration}
                    showLabel={isHovered}
                />

                {/* Selection checkbox */}
                {onSelectedChanged && (
                    <div
                        className={cx("cinema-select-overlay absolute top-2 left-2 z-20", {
                            "is-active": selecting || selected,
                        })}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelectedChanged(!selected!, false);
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={selected ?? false}
                            readOnly
                            className="h-4 w-4 cursor-pointer rounded"
                        />
                    </div>
                )}

                {extraActions && (
                    <div
                        className="absolute top-2 right-2 z-20"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                        {extraActions}
                    </div>
                )}
            </div>

            {/* ── Card body ─────────────────────────────────── */}
            <div
                className="flex flex-col gap-[7px] px-3 pt-2 pb-[10px] flex-1"
                style={{ background: "#0d0d0f" }}
            >
                {/* Studio + rating */}
                <div className="flex items-center justify-between min-h-[16px]">
                    {scene.studio ? (
                        <button
                            type="button"
                            className="flex items-center min-w-0 max-w-[65%] bg-transparent border-0 p-0 cursor-pointer"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                history.push(apihubEntityLink("studio", scene.studio!.id) ?? `/studios/${scene.studio!.id}`);
                            }}
                        >
                            {scene.studio.image_path ? (
                                <img
                                    src={scene.studio.image_path}
                                    alt={scene.studio.name}
                                    className="h-[13px] w-auto max-w-[80px] object-contain opacity-55 hover:opacity-85 transition-opacity duration-200"
                                />
                            ) : (
                                <span className="text-[9px] font-bold tracking-[0.14em] uppercase text-white/30 truncate hover:text-white/55 transition-colors duration-200">
                                    {scene.studio.name}
                                </span>
                            )}
                        </button>
                    ) : (
                        <span />
                    )}

                    {scene.rating100 != null && (
                        <RatingDots rating100={scene.rating100} />
                    )}
                </div>

                {/* Title */}
                <p
                    className="text-[0.88rem] font-semibold leading-snug text-white/80 group-hover:text-white/95 transition-colors duration-200 m-0"
                    style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                    }}
                >
                    {title}
                </p>

                {/* Performers row */}
                {performers.length > 0 && (
                    <div className="flex items-center gap-[7px]">
                        {/* Stacked avatars */}
                        <div className="flex items-center flex-shrink-0">
                            {performers.map((p, i) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    title={p.name}
                                    className="relative rounded-full overflow-hidden flex-shrink-0 bg-transparent border-0 p-0 cursor-pointer"
                                    style={{
                                        width: 20,
                                        height: 20,
                                        marginLeft: i === 0 ? 0 : -6,
                                        zIndex: performers.length - i,
                                        outline: "1.5px solid #0d0d0f",
                                    }}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        history.push(apihubEntityLink("performer", p.id) ?? `/performers/${p.id}`);
                                    }}
                                >
                                    {p.image_path ? (
                                        <img
                                            src={p.image_path}
                                            alt={p.name}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-[8px] font-bold text-white/50 bg-white/10">
                                            {p.name.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Names (fade in on hover) */}
                        <span className="cinema-performer-names text-[0.67rem] text-white/38 truncate leading-none">
                            {performers.map((p) => p.name).join(" · ")}
                        </span>
                    </div>
                )}
            </div>
        </>
    );

    return (
        <div
            className={cx("cinema-card group relative rounded-xl overflow-hidden flex flex-col", {
                "ring-2 ring-white/25": selected,
            })}
            style={{
                background: "#0d0d0f",
                border: "1px solid rgba(255,255,255,0.05)",
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {isExternal ? (
                <a
                    href={sceneLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    {...linkProps}
                    onClick={selecting ? (e) => e.preventDefault() : undefined}
                >
                    {inner}
                </a>
            ) : (
                <Link
                    to={selecting ? "#" : sceneLink}
                    {...linkProps}
                    onClick={selecting ? (e) => e.preventDefault() : undefined}
                >
                    {inner}
                </Link>
            )}
        </div>
    );
};
