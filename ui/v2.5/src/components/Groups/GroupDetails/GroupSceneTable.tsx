import React, { useMemo } from "react";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { Typography } from "@mui/material";
import { Row, Col } from "src/components/Shared/Layouts";
import { Scene, SceneSelect } from "src/components/Scenes/SceneSelect";
import cx from "classnames";
import { NumberField } from "src/utils/form";

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
                    <Row key={m.scene.id} className="group-row">
                        <Col xs={9}>
                            <SceneSelect
                                onSelect={(items) => onSceneSet(i, items)}
                                values={[m.scene!]}
                                excludeIds={sceneIDs}
                            />
                        </Col>
                        <Col xs={3}>
                            <NumberField
                                className="text-input"
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
                        </Col>
                    </Row>
                ))}
                <Row className="group-row">
                    <Col xs={9}>
                        <SceneSelect
                            onSelect={(items) => onNewSceneSet(items)}
                            values={[]}
                            excludeIds={sceneIDs}
                            className="bg-secondary"
                            noSelectionString={intl.formatMessage({ id: "Select Scene" })}
                        />
                    </Col>
                    <Col xs={3} />
                </Row>
            </>
        );
    }

    return (
        <div className={cx("group-table", { "no-groups": !value.length })}>
            <Row className="group-table-header">
                <Col xs={9}></Col>
                <Col xs={3}>
                    <Typography variant="body2" className="group-scene-number-header">
                        {intl.formatMessage({ id: "group_scene_number" })}
                    </Typography>
                </Col>
            </Row>
            {renderTableData()}
        </div>
    );
};
