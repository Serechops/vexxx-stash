import React, { useMemo } from "react";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { Typography, Grid, IconButton } from "@mui/material";
import { Scene, SceneSelect } from "src/components/Scenes/SceneSelect";
import cx from "classnames";
import { NumberField } from "src/utils/form";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash } from "@fortawesome/free-solid-svg-icons";

export interface ISceneEntry {
    scene: Scene;
    scene_index?: GQL.InputMaybe<number> | undefined;
}

export interface IProps {
    value: ISceneEntry[];
    onUpdate: (input: ISceneEntry[]) => void;
}

export const GroupSceneTable: React.FC<IProps> = (props) => {
    const { value, onUpdate } = props;

    const intl = useIntl();

    const sceneIDs = useMemo(() => value.map((m) => m.scene.id), [value]);

    const updateFieldChanged = (index: number, sceneIndex: number | null) => {
        const newValues = value.map((existing, i) => {
            if (i === index) {
                return {
                    ...existing,
                    scene_index: sceneIndex,
                };
            }
            return existing;
        });

        onUpdate(newValues);
    };

    function onSceneSet(index: number, scenes: Scene[]) {
        if (!scenes.length) {
            // remove this entry
            const newValues = value.filter((_, i) => i !== index);
            onUpdate(newValues);
            return;
        }

        const scene = scenes[0];

        const newValues = value.map((existing, i) => {
            if (i === index) {
                return {
                    ...existing,
                    scene: scene,
                };
            }
            return existing;
        });

        onUpdate(newValues);
    }

    function onNewSceneSet(scenes: Scene[]) {
        if (!scenes.length) {
            return;
        }

        const scene = scenes[0];

        const maxIndex = value.reduce((max, curr) => {
            if (curr.scene_index !== null && curr.scene_index !== undefined) {
                return Math.max(max, curr.scene_index);
            }
            return max;
        }, 0);

        const newValues = [
            ...value,
            {
                scene: scene,
                scene_index: maxIndex + 1,
            },
        ];

        onUpdate(newValues);
    }

    function renderTableData() {
        return (
            <>
                {value.map((m, i) => (
                    <Grid container key={m.scene.id} className="vexxx-scene-list-item align-items-center py-2 border-bottom" spacing={2}>
                        <Grid size="auto">
                            {m.scene.paths?.screenshot ? (
                                <img
                                    src={m.scene.paths.screenshot}
                                    className="vexxx-scene-list-image"
                                    alt={m.scene.title || ""}
                                />
                            ) : (
                                <div className="vexxx-scene-list-image placeholder" />
                            )}
                        </Grid>
                        <Grid size="grow" className="vexxx-scene-list-details">
                            <Typography variant="body2" component="div" className="vexxx-scene-list-title font-weight-bold">
                                {m.scene.title}
                            </Typography>
                            <Typography variant="caption" color="textSecondary" className="vexxx-scene-list-meta">
                                {m.scene.code && <span className="vexxx-scene-list-code mr-2">{m.scene.code}</span>}
                                {m.scene.date}
                            </Typography>
                        </Grid>
                        <Grid size={{ xs: 3 }}>
                            <NumberField
                                className="vexxx-scene-list-input text-input"
                                value={m.scene_index ?? ""}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    updateFieldChanged(
                                        i,
                                        e.currentTarget.value === ""
                                            ? null
                                            : Number.parseInt(e.currentTarget.value, 10)
                                    );
                                }}
                            />
                        </Grid>
                        <Grid size="auto">
                            <IconButton
                                size="small"
                                color="secondary"
                                onClick={() => onSceneSet(i, [])} // Empty array removes the scene
                                title={intl.formatMessage({ id: "actions.delete" })}
                                className="vexxx-scene-list-delete"
                            >
                                <FontAwesomeIcon icon={faTrash} />
                            </IconButton>
                        </Grid>
                    </Grid>
                ))}
                <Grid container className="group-row mt-3" spacing={2}>
                    <Grid size="grow">
                        <SceneSelect
                            onSelect={(items) => onNewSceneSet(items)}
                            values={[]}
                            excludeIds={sceneIDs}
                            className="bg-secondary"
                            noSelectionString={intl.formatMessage({ id: "actions.select_entity" }, { entityType: intl.formatMessage({ id: "scene" }) })}
                        />
                    </Grid>
                    <Grid size={{ xs: 3 }} />
                    <Grid size="auto" style={{ width: 40 }} /> {/* Spacer for delete button alignment */}
                </Grid>
            </>
        );
    }

    return (
        <div className={cx("group-table", { "no-groups": !value.length })}>
            <Grid container className="group-table-header mb-2" spacing={2}>
                <Grid size="grow" />
                <Grid size={{ xs: 3 }}>
                    <Typography variant="body2" className="group-scene-number-header text-center">
                        {intl.formatMessage({ id: "group_scene_number" })}
                    </Typography>
                </Grid>
                <Grid size="auto" style={{ width: 40 }} />
            </Grid>
            {renderTableData()}
        </div>
    );
};
