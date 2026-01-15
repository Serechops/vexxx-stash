import React, { useMemo, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../Shared/Icon";
import { HoverVideoPreview } from "./HoverVideoPreview";
import {
    faBolt,
    faPlayCircle,
    faStar,
    faTag,
    faVideo,
} from "@fortawesome/free-solid-svg-icons";
import { objectTitle } from "src/core/files";
import { SceneQueue } from "src/models/sceneQueue";
import { useConfigurationContext } from "src/hooks/Config";
import TextUtils from "src/utils/text";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
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
        <div
            className={cx("scene-card-modern", { "selected": selected })}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleCardClick}
            style={{ width: width ? width : "100%" }}
        >
            <Link to={selecting ? "#" : sceneLink} className="scene-card-link" onClick={e => selecting && e.preventDefault()}>
                <div className="scene-card-preview">
                    <HoverVideoPreview
                        image={scene.paths.screenshot ?? undefined}
                        video={scene.paths.preview ?? undefined}
                        isHovered={isHovered}
                        soundActive={configuration?.interface?.soundOnPreview ?? false}
                        isPortrait={false}
                        vttPath={scene.paths.vtt ?? undefined}
                    />
                    <div className="modern-overlay"></div>
                    {duration && <div className="duration-badge">{duration}</div>}

                    {/* Selection Checkbox Overlay */}
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
                </div>

                <div className="modern-content">
                    <div className="modern-title" title={objectTitle(scene)}>
                        {objectTitle(scene)}
                    </div>

                    <div className="modern-meta-row">
                        {scene.date && <span>{scene.date}</span>}
                        {resolution && (
                            <>
                                <span>•</span>
                                <span>•</span>
                                <Chip label={resolution} size="small" variant="outlined" />
                            </>
                        )}
                        {rating && (
                            <span className="ml-auto text-warning font-weight-bold">
                                <Icon icon={faStar} /> {rating}
                            </span>
                        )}
                    </div>

                    <div className="modern-performers">
                        {scene.performers.map(p => (
                            <span
                                key={p.id}
                                className="performer-tag"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    history.push(`/performers/${p.id}`);
                                }}
                            >
                                {p.name}
                            </span>
                        ))}
                    </div>

                    <div className="modern-studio d-flex justify-content-between align-items-center">
                        {scene.studio && (
                            <div
                                className="text-muted small cursor-pointer"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    history.push(`/studios/${scene.studio?.id}`);
                                }}
                            >
                                {scene.studio.name}
                            </div>
                        )}

                        {/* O-Counter Quick Action */}
                        <Tooltip title="Increment O-Counter" arrow>
                            <IconButton
                                size="small"
                                className="p-0 text-muted hover-text-danger"
                                onClick={onIncrementO}
                            >
                                <Icon icon={faBolt} className={scene.o_counter ? "text-danger" : ""} />
                                {scene.o_counter ? <span className="ml-1 small">{scene.o_counter}</span> : null}
                            </IconButton>
                        </Tooltip>
                    </div>
                </div>
            </Link>
        </div>
    );
};
