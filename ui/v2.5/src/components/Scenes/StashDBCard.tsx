import React, { useMemo, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { HoverVideoPreview } from "./HoverVideoPreview";
import BoltIcon from "@mui/icons-material/Bolt";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import StarIcon from "@mui/icons-material/Star";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import VideocamIcon from "@mui/icons-material/Videocam";
import { objectTitle } from "src/core/files";
import { SceneQueue } from "src/models/sceneQueue";
import { useConfigurationContext } from "src/hooks/Config";
import TextUtils from "src/utils/text";
import { Box, Tooltip, IconButton, Chip } from "@mui/material";
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
}

export const StashDBCard: React.FC<ISceneCardProps> = ({
    scene,
    width,
    index,
    queue,
    selecting,
    selected,
    onSelectedChanged,
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

    const duration = file?.duration ? TextUtils.secondsToTimestamp(file.duration) : null;
    const resolution = file?.width && file?.height ? TextUtils.resolution(file.width, file.height) : null;
    const rating = scene.rating100 ? Math.round(scene.rating100 / 20 * 10) / 10 : null;

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
            className={cx("scene-card-modern", { "selected": selected })}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleCardClick}
            sx={{
                position: "relative",
                borderRadius: "8px",
                overflow: "hidden",
                backgroundColor: "background.paper",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                width: width ? width : "100%",
                "&:hover": {
                    transform: "translateY(-4px)",
                    boxShadow: "0 12px 24px rgba(0, 0, 0, 0.4)",
                    borderColor: "primary.main",
                    zIndex: 10,
                },
                "&.selected": {
                    borderColor: "primary.main",
                    boxShadow: (theme: any) => `0 0 0 2px ${theme.palette.primary.main}4d`, // 0.3 opacity
                }
            }}
        >
            <Link to={selecting ? "#" : sceneLink} className="scene-card-link" onClick={e => selecting && e.preventDefault()} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Box
                    className="scene-card-preview"
                    sx={{
                        position: "relative",
                        aspectRatio: "16 / 9",
                        overflow: "hidden",
                        backgroundColor: "#000",
                        "& .scene-card-preview-image": {
                            transition: "opacity 0.2s",
                            "&.hidden": { opacity: 0 }
                        },
                        "& .scene-card-preview-video": {
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            background: "#000",
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
                    <Box
                        className="modern-overlay"
                        sx={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: "50px",
                            background: "linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent)",
                            pointerEvents: "none",
                        }}
                    />
                    {duration && (
                        <Box
                            className="duration-badge"
                            sx={{
                                position: "absolute",
                                bottom: "6px",
                                right: "6px",
                                backgroundColor: "rgba(0, 0, 0, 0.7)",
                                color: "#fff",
                                fontSize: "0.7rem",
                                fontWeight: 700,
                                padding: "2px 5px",
                                borderRadius: "4px",
                                backdropFilter: "blur(2px)",
                            }}
                        >
                            {duration}
                        </Box>
                    )}

                    {/* Selection Checkbox Overlay */}
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
                </Box>

                <Box
                    className="modern-content"
                    sx={{
                        padding: "10px 12px",
                        flexGrow: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                    }}
                >
                    <Box
                        className="modern-title"
                        title={objectTitle(scene)}
                        sx={{
                            fontSize: "0.95rem",
                            fontWeight: 700,
                            lineHeight: 1.25,
                            mb: "2px",
                            color: "text.primary",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}
                    >
                        {objectTitle(scene)}
                    </Box>

                    <Box
                        className="modern-meta-row"
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            fontSize: "0.75rem",
                            color: "text.secondary",
                            mb: "4px",
                        }}
                    >
                        {scene.date && <span>{scene.date}</span>}
                        {resolution && (
                            <>
                                <span>•</span>
                                <Chip label={resolution} size="small" variant="outlined" sx={{ fontSize: "0.65rem", height: "18px" }} />
                            </>
                        )}
                        {rating && (
                            <Box
                                component="span"
                                sx={{ ml: "auto", color: "warning.main", fontWeight: "bold", display: "flex", alignItems: "center", gap: "2px" }}
                            >
                                <StarIcon sx={{ fontSize: 14 }} /> {rating}
                            </Box>
                        )}
                    </Box>

                    <Box
                        className="modern-performers"
                        sx={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                            mt: "auto",
                        }}
                    >
                        {scene.performers.map(p => (
                            <Box
                                component="span"
                                key={p.id}
                                className="performer-tag"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    history.push(`/performers/${p.id}`);
                                }}
                                sx={{
                                    fontSize: "0.8rem",
                                    fontWeight: 500,
                                    color: "text.primary",
                                    cursor: "pointer",
                                    transition: "color 0.15s",
                                    "&:hover": {
                                        color: "primary.main",
                                    }
                                }}
                            >
                                {p.name}
                            </Box>
                        ))}
                    </Box>

                    <Box
                        className="modern-studio"
                        sx={{
                            mt: "8px",
                            pt: "8px",
                            borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        {scene.studio && (
                            <Box
                                className="text-muted small cursor-pointer"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    history.push(`/studios/${scene.studio?.id}`);
                                }}
                                sx={{
                                    color: "text.secondary",
                                    fontSize: "0.8125rem",
                                    cursor: "pointer",
                                    "&:hover": { textDecoration: "underline" }
                                }}
                            >
                                {scene.studio.name}
                            </Box>
                        )}

                        {/* O-Counter Quick Action */}
                        <Tooltip title="Increment O-Counter" arrow>
                            <IconButton
                                size="small"
                                sx={{
                                    p: 0,
                                    color: "text.secondary",
                                    "&:hover": { color: "error.main" }
                                }}
                                onClick={onIncrementO}
                            >
                                <BoltIcon sx={{ color: scene.o_counter ? "error.main" : "inherit" }} />
                                {scene.o_counter ? <Box component="span" sx={{ ml: 0.5, fontSize: "0.75rem" }}>{scene.o_counter}</Box> : null}
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Box>
            </Link>
        </Box>
    );
};
