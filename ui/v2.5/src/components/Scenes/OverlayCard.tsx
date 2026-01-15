import React, { useMemo, useState } from "react";
import { Box } from "@mui/material";
import { Link, useHistory } from "react-router-dom";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../Shared/Icon";
import { HoverVideoPreview } from "./HoverVideoPreview";
import {
    faBolt,
    faPlay,
    faStar,
} from "@fortawesome/free-solid-svg-icons";
import { objectTitle } from "src/core/files";
import { SceneQueue } from "src/models/sceneQueue";
import { useConfigurationContext } from "src/hooks/Config";
import TextUtils from "src/utils/text";
// Button, Tooltip, OverlayTrigger, Badge removed
import { useSceneIncrementO } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";



interface ISceneCardProps {
    scene: GQL.SlimSceneDataFragment;
    width?: number;
    previewHeight?: number;
    index?: number;
    queue?: SceneQueue;
    compact?: boolean;
    selecting?: boolean;
    selected?: boolean | undefined;
    zoomIndex?: number;
    onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
    fromGroupId?: string;
    // Extensions for non-standard use (e.g. Scraped Cards)
    link?: string;
    extraActions?: React.ReactNode;
}

export const OverlayCard: React.FC<ISceneCardProps> = ({
    scene,
    width,
    index,
    queue,
    selecting,
    selected,
    onSelectedChanged,
    link,
    extraActions,
}) => {
    const history = useHistory();
    const { configuration } = useConfigurationContext();
    const Toast = useToast();
    const cont = configuration?.interface.continuePlaylistDefault ?? false;

    const file = useMemo(
        () => (scene.files.length > 0 ? scene.files[0] : undefined),
        [scene]
    );

    const sceneLink = queue
        ? queue.makeLink(scene.id, {
            sceneIndex: index,
            continue: cont,
        })
        : `/scenes/${scene.id}`;

    const finalLink = link ?? sceneLink;
    const isInternalLink = !link || link.startsWith("/");

    const rating = scene.rating100 ? Math.round(scene.rating100 / 20 * 10) / 10 : null;
    const duration = file?.duration ? TextUtils.secondsToTimestamp(file.duration) : null;
    const resolution = file?.width && file?.height ? TextUtils.resolution(file.width, file.height) : null;

    const [isHovered, setIsHovered] = useState(false);
    const [incrementO] = useSceneIncrementO(scene.id);

    async function onIncrementO(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        try {
            await incrementO();
            Toast.success(`Incremented O-Counter for ${objectTitle(scene)}`);
        } catch (err) {
            Toast.error(err);
        }
    }

    function onSelectChange(e: React.MouseEvent) {
        e.stopPropagation();
        if (onSelectedChanged) {
            onSelectedChanged(!selected, e.shiftKey);
        }
    }

    const handleCardClick = (e: React.MouseEvent) => {
        if (selecting) {
            onSelectChange(e);
            e.preventDefault();
        }
    };

    return (
        <Box
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleCardClick}
            sx={{
                position: "relative",
                borderRadius: "8px",
                overflow: "hidden",
                backgroundColor: "#000",
                transition: "all 0.3s ease",
                height: "100%",
                width: width ? width : "100%",
                "&:hover": {
                    transform: "scale(1.02)",
                    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
                    zIndex: 20,
                    "& .overlay-content": {
                        background: "linear-gradient(to top, rgba(0, 0, 0, 0.95) 20%, rgba(0, 0, 0, 0.7) 60%, transparent 100%)",
                    }
                },
                "&.selected": {
                    boxShadow: (theme: any) => `0 0 0 3px ${theme.palette.primary.main}`,
                }
            }}
            className={cx("scene-card-overlay-variant", { "selected": selected })}
        >
            {isInternalLink ? (
                <Link to={selecting ? "#" : finalLink} className="scene-card-link" onClick={e => selecting && e.preventDefault()} style={{ textDecoration: 'none', color: 'inherit' }}>
                    {renderCardContent()}
                </Link>
            ) : (
                <a href={finalLink} className="scene-card-link" target="_blank" rel="noopener noreferrer" onClick={e => selecting && e.preventDefault()} style={{ textDecoration: 'none', color: 'inherit' }}>
                    {renderCardContent()}
                </a>
            )}
        </Box>
    );

    function renderCardContent() {
        return (
            <>
                {/* Media Container: Full Bleed */}
                <Box
                    className="overlay-media"
                    sx={{
                        position: "relative",
                        width: "100%",
                        aspectRatio: "16 / 9",
                        "& .scene-card-preview-image": {
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            transition: "opacity 0.3s",
                            "&.hidden": { opacity: 0 }
                        },
                        "& .scene-card-preview-video": {
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            "&.hidden": { display: "none" }
                        }
                    }}
                >
                    <HoverVideoPreview
                        image={scene.paths.screenshot ?? undefined}
                        video={scene.paths.preview ?? undefined}
                        isHovered={isHovered}
                        soundActive={configuration?.interface?.soundOnPreview ?? false}
                        isPortrait={false}
                        vttPath={scene.paths.vtt ?? undefined}
                    />

                    {extraActions && (
                        <Box
                            sx={{ position: "absolute", top: "0.5rem", right: "0.5rem", zIndex: 20 }}
                            onClick={e => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}>
                            {extraActions}
                        </Box>
                    )}
                </Box>

                {/* Gradient Overlay & Content */}
                <Box
                    className="overlay-content"
                    sx={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: "linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%)",
                        padding: "12px",
                        color: "#fff",
                        transition: "background 0.3s ease",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-end",
                    }}
                >
                    <Box
                        className="overlay-title-row"
                        sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            mb: "4px",
                        }}
                    >
                        <Box
                            className="scene-title"
                            title={objectTitle(scene)}
                            sx={{
                                fontSize: "1rem",
                                fontWeight: 700,
                                textShadow: "0 2px 4px rgba(0, 0, 0, 0.8)",
                                lineHeight: 1.2,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                                mr: "8px",
                            }}
                        >
                            {objectTitle(scene)}
                        </Box>
                        {rating && (
                            <Box
                                className="scene-rating"
                                sx={{
                                    fontSize: "0.85rem",
                                    fontWeight: 700,
                                    whiteSpace: "nowrap",
                                    textShadow: "0 2px 4px rgba(0, 0, 0, 0.8)",
                                    color: "warning.main",
                                }}
                            >
                                <Icon icon={faStar} /> {rating}
                            </Box>
                        )}
                    </Box>

                    <Box
                        className="overlay-meta-row"
                        sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "0.8rem",
                            color: "rgba(255, 255, 255, 0.8)",
                            "& .date": { color: "inherit" },
                        }}
                    >
                        <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            {scene.date && <span className="date">{scene.date}</span>}
                            {scene.studio && (
                                <Box
                                    component="span"
                                    className="studio-link"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        history.push(`/studios/${scene.studio?.id}`);
                                    }}
                                    sx={{
                                        cursor: "pointer",
                                        "&:hover": {
                                            color: "#fff",
                                            textDecoration: "underline",
                                        }
                                    }}
                                >
                                    • {scene.studio.name}
                                </Box>
                            )}
                            <Box sx={{ ml: "8px", display: "flex", gap: "4px" }}>
                                {resolution && (
                                    <Box
                                        component="span"
                                        className="badge badge-secondary"
                                        sx={{
                                            backgroundColor: "rgba(255, 255, 255, 0.2)",
                                            color: "#fff",
                                            backdropFilter: "blur(4px)",
                                            border: 0,
                                            padding: "2px 4px",
                                            fontSize: "0.75rem",
                                            "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.3)" }
                                        }}
                                    >
                                        {resolution}
                                    </Box>
                                )}
                                {duration && (
                                    <Box
                                        component="span"
                                        className="badge badge-secondary"
                                        sx={{
                                            backgroundColor: "rgba(255, 255, 255, 0.2)",
                                            color: "#fff",
                                            backdropFilter: "blur(4px)",
                                            border: 0,
                                            padding: "2px 4px",
                                            fontSize: "0.75rem",
                                            "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.3)" }
                                        }}
                                    >
                                        {duration}
                                    </Box>
                                )}
                            </Box>
                        </Box>
                        <Box>
                            {/* O-Counter */}
                            <Box
                                className={cx("o-counter", { active: scene.o_counter })}
                                sx={{
                                    opacity: 0.6,
                                    fontSize: "0.75rem",
                                    "&.active": { opacity: 1, color: "#fff" },
                                    display: "flex",
                                    alignItems: "center",
                                }}
                            >
                                <Icon icon={faBolt} className="mr-1" />
                                {scene.o_counter || 0}
                            </Box>
                        </Box>
                    </Box>

                    {/* Expanded Content (Slide Up on Hover) */}
                    <Box
                        className={cx("overlay-slide-content", { visible: isHovered })}
                        sx={{
                            maxHeight: 0,
                            overflow: "hidden",
                            opacity: 0,
                            transition: "all 0.3s ease-in-out",
                            "&.visible": {
                                maxHeight: "100px",
                                opacity: 1,
                                mt: "8px",
                            }
                        }}
                    >
                        {/* Performers */}
                        {scene.performers.length > 0 && (
                            <Box
                                className="performers-list"
                                sx={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "4px",
                                    mb: "4px",
                                }}
                            >
                                {scene.performers.slice(0, 4).map(p => (
                                    <Box
                                        component="span"
                                        key={p.id}
                                        className="performer-pill"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            history.push(`/performers/${p.id}`);
                                        }}
                                        sx={{
                                            background: "rgba(255, 255, 255, 0.2)",
                                            backdropFilter: "blur(4px)",
                                            padding: "2px 8px 2px 4px",
                                            borderRadius: "12px",
                                            fontSize: "0.75rem",
                                            fontWeight: 600,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "4px",
                                            cursor: "pointer",
                                            transition: "background 0.2s",
                                            "&:hover": { background: "rgba(255, 255, 255, 0.4)" },
                                            "& img": {
                                                width: "16px",
                                                height: "16px",
                                                borderRadius: "50%",
                                                objectFit: "cover",
                                            }
                                        }}
                                    >
                                        {p.image_path && <img src={p.image_path} alt="" />}
                                        {p.name}
                                    </Box>
                                ))}
                            </Box>
                        )}

                        {/* Tags preview */}
                        {scene.tags.length > 0 && (
                            <Box
                                className="tags-preview"
                                sx={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "6px",
                                }}
                            >
                                {scene.tags.slice(0, 3).map(t => (
                                    <Box
                                        component="span"
                                        key={t.id}
                                        className="tag-dot"
                                        sx={{
                                            fontSize: "0.7rem",
                                            color: "rgba(255, 255, 255, 0.6)",
                                        }}
                                    >
                                        #{t.name}
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                </Box>

                {/* Selection Checkbox */}
                {selecting && (
                    <Box sx={{ position: "absolute", top: "0.5rem", left: "0.5rem", zIndex: 20 }}>
                        <input
                            type="checkbox"
                            checked={selected}
                            readOnly
                            style={{ cursor: "pointer", height: "1.25rem", width: "1.25rem" }}
                        />
                    </Box>
                )}
            </>
        );
    }
};
