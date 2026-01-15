import React, { useMemo } from "react";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { Box, Typography, TextField } from "@mui/material";
import { Row, Col } from "src/components/Shared/Layouts";
import { Group, GroupSelect } from "src/components/Groups/GroupSelect";
import cx from "classnames";

export type GroupSceneIndexMap = Map<string, number | undefined>;

export interface IGroupEntry {
  group: Group;
  scene_index?: GQL.InputMaybe<number> | undefined;
}

export interface IProps {
  value: IGroupEntry[];
  onUpdate: (input: IGroupEntry[]) => void;
}

export const SceneGroupTable: React.FC<IProps> = (props) => {
  const { value, onUpdate } = props;

  const intl = useIntl();

  const groupIDs = useMemo(() => value.map((m) => m.group.id), [value]);

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

  function onGroupSet(index: number, groups: Group[]) {
    if (!groups.length) {
      // remove this entry
      const newValues = value.filter((_, i) => i !== index);
      onUpdate(newValues);
      return;
    }

    const group = groups[0];

    const newValues = value.map((existing, i) => {
      if (i === index) {
        return {
          ...existing,
          group: group,
        };
      }
      return existing;
    });

    onUpdate(newValues);
  }

  function onNewGroupSet(groups: Group[]) {
    if (!groups.length) {
      return;
    }

    const group = groups[0];

    const newValues = [
      ...value,
      {
        group: group,
        scene_index: null,
      },
    ];

    onUpdate(newValues);
  }

  function renderTableData() {
    return (
      <>
        {value.map((m, i) => (
          <Row key={m.group.id} className="group-row">
            <Col xs={9}>
              <GroupSelect
                onSelect={(items) => onGroupSet(i, items)}
                values={[m.group!]}
                excludeIds={groupIDs}
              />
            </Col>
            <Col xs={3}>
              <TextField
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
                type="number"
                size="small"
                variant="outlined"
              />
            </Col>
          </Row>
        ))}
        <Row className="group-row">
          <Col xs={12}>
            <GroupSelect
              onSelect={(items) => onNewGroupSet(items)}
              values={[]}
              excludeIds={groupIDs}
            />
          </Col>
        </Row>
      </>
    );
  }

  return (
    <div className={cx("group-table", { "no-groups": !value.length })}>
      <Row className="group-table-header">
        <Col xs={9}></Col>
        <Col xs={3} className="group-scene-number-header">
          <Typography variant="body2" component="label">
            {intl.formatMessage({ id: "group_scene_number" })}
          </Typography>
        </Col>
      </Row>
      {renderTableData()}
    </div>
  );
};
