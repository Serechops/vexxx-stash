import React, { useMemo, useState } from "react";
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
import { Button, Tooltip, OverlayTrigger, Badge } from "react-bootstrap";
import { useSceneIncrementO } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";

import "./scene-card-variants.scss";

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

export const OverlayCard: React.FC<ISceneCardProps> = ({
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
        <div
            className={cx("scene-card-overlay-variant", { "selected": selected })}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleCardClick}
            style={{ width: width ? width : "100%" }}
        >
            <Link to={selecting ? "#" : sceneLink} className="scene-card-link" onClick={e => selecting && e.preventDefault()}>

                {/* Media Container: Full Bleed */}
                <div className="overlay-media">
                    <HoverVideoPreview
                        image={scene.paths.screenshot ?? undefined}
                        video={scene.paths.preview ?? undefined}
                        isHovered={isHovered}
                        soundActive={configuration?.interface?.soundOnPreview ?? false}
                        isPortrait={false}
                        vttPath={scene.paths.vtt ?? undefined}
                    />

                    {/* Top Right Badges */}

                </div>

                {/* Gradient Overlay & Content */}
                <div className="overlay-content">
                    <div className="overlay-title-row">
                        <div className="scene-title" title={objectTitle(scene)}>
                            {objectTitle(scene)}
                        </div>
                        {rating && (
                            <div className="scene-rating text-warning">
                                <Icon icon={faStar} /> {rating}
                            </div>
                        )}
                    </div>

                    <div className="overlay-meta-row">
                        <div className="meta-left">
                            {scene.date && <span className="date">{scene.date}</span>}
                            {scene.studio && (
                                <span
                                    className="studio-link"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        history.push(`/studios/${scene.studio?.id}`);
                                    }}
                                >
                                    • {scene.studio.name}
                                </span>
                            )}
                            <div className="ml-2 flex gap-1">
                                {resolution && <Badge variant="secondary" className="bg-white/20 hover:bg-white/30 text-white backdrop-blur-md border-0">{resolution}</Badge>}
                                {duration && <Badge variant="secondary" className="bg-white/20 hover:bg-white/30 text-white backdrop-blur-md border-0">{duration}</Badge>}
                            </div>
                        </div>
                        <div>
                            {/* O-Counter */}
                            <div className={cx("o-counter", { active: scene.o_counter })}>
                                <Icon icon={faBolt} className="mr-1" />
                                {scene.o_counter || 0}
                            </div>
                        </div>
                    </div>

                    {/* Expanded Content (Slide Up on Hover) */}
                    <div className={cx("overlay-slide-content", { visible: isHovered })}>
                        {/* Performers */}
                        {scene.performers.length > 0 && (
                            <div className="performers-list">
                                {scene.performers.slice(0, 4).map(p => (
                                    <span key={p.id} className="performer-pill" onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        history.push(`/performers/${p.id}`);
                                    }}>
                                        {p.image_path && <img src={p.image_path} alt="" />}
                                        {p.name}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Tags preview */}
                        {scene.tags.length > 0 && (
                            <div className="tags-preview">
                                {scene.tags.slice(0, 3).map(t => (
                                    <span key={t.id} className="tag-dot">#{t.name}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Selection Checkbox */}
                {selecting && (
                    <div className="absolute top-2 left-2 z-20">
                        <input
                            type="checkbox"
                            checked={selected}
                            readOnly
                            className="form-checkbox h-5 w-5 text-primary"
                            style={{ cursor: "pointer" }}
                        />
                    </div>
                )}
            </Link>
        </div>
    );
};
