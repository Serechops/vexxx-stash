import React from "react";
import { Box, Divider, Table, TableBody, TableRow, TableCell, Typography } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";
import { TagLink } from "src/components/Shared/TagLink";
import { PerformerCard } from "src/components/Performers/PerformerCard";
import { sortPerformers } from "src/core/performers";
import { DirectorLink } from "src/components/Shared/Link";

interface ISceneDetailProps {
  scene: GQL.SceneDataFragment;
}

export const SceneDetailPanel: React.FC<ISceneDetailProps> = (props) => {
  const intl = useIntl();

  function renderDetails() {
    if (!props.scene.details || props.scene.details === "") return;
    return (
      <Box sx={{ mt: 2, mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          <FormattedMessage id="details" />
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
          {props.scene.details}
        </Typography>
      </Box>
    );
  }

  function renderTags() {
    if (props.scene.tags.length === 0) return;
    const tags = props.scene.tags.map((tag) => (
      <TagLink key={tag.id} tag={tag} />
    ));
    return (
      <Box sx={{ mt: 2 }}>
        <Divider sx={{ mb: 1 }} />
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          <FormattedMessage
            id="countables.tags"
            values={{ count: props.scene.tags.length }}
          />
        </Typography>
        {tags}
      </Box>
    );
  }

  function renderPerformers() {
    if (props.scene.performers.length === 0) return;
    const performers = sortPerformers(props.scene.performers);
    const cards = performers.map((performer) => (
      <PerformerCard
        key={performer.id}
        performer={performer}
        ageFromDate={props.scene.date ?? undefined}
      />
    ));

    return (
      <Box sx={{ mt: 2 }}>
        <Divider sx={{ mb: 1 }} />
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          <FormattedMessage
            id="countables.performers"
            values={{ count: props.scene.performers.length }}
          />
        </Typography>
        <Box
          sx={{
            display: 'flex',
            overflowX: 'auto',
            gap: 2,
            pb: 1,
            scrollSnapType: 'x mandatory',
            '&::-webkit-scrollbar': { height: 6 },
            '&::-webkit-scrollbar-thumb': {
              borderRadius: 3,
              bgcolor: 'action.hover',
            },
            '& .performer-card': {
              flex: '0 0 auto',
              width: '15rem',
              scrollSnapAlign: 'start',
            },
            '& .performer-card-image': { height: '22.5rem' },
          }}
        >
          {cards}
        </Box>
      </Box>
    );
  }

  const labelSx = {
    color: "text.secondary",
    width: "1%",
    whiteSpace: "nowrap",
    border: 0,
    py: 0.5,
    pl: 0,
    pr: 2,
  } as const;

  const valueSx = { border: 0, py: 0.5 } as const;

  return (
    <>
      <Box>
        {renderDetails()}
        <Divider sx={{ my: 1 }} />
        <Table size="small">
          <TableBody>
            <TableRow>
              <TableCell sx={labelSx}>
                <FormattedMessage id="created_at" />
              </TableCell>
              <TableCell sx={valueSx}>
                {TextUtils.formatDateTime(intl, props.scene.created_at)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={labelSx}>
                <FormattedMessage id="updated_at" />
              </TableCell>
              <TableCell sx={valueSx}>
                {TextUtils.formatDateTime(intl, props.scene.updated_at)}
              </TableCell>
            </TableRow>
            {props.scene.code && (
              <TableRow>
                <TableCell sx={labelSx}>
                  <FormattedMessage id="scene_code" />
                </TableCell>
                <TableCell sx={valueSx}>{props.scene.code}</TableCell>
              </TableRow>
            )}
            {props.scene.director && (
              <TableRow>
                <TableCell sx={labelSx}>
                  <FormattedMessage id="director" />
                </TableCell>
                <TableCell sx={valueSx}>
                  <DirectorLink
                    director={props.scene.director}
                    linkType="scene"
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      <Box>
        {renderTags()}
        {renderPerformers()}
      </Box>
    </>
  );
};

export default SceneDetailPanel;
