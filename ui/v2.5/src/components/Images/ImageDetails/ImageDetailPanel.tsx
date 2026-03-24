import React from "react";
import {
  Box,
  Divider,
  Table,
  TableBody,
  TableRow,
  TableCell,
  Typography,
} from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";
import { GalleryLink, TagLink } from "src/components/Shared/TagLink";
import { PerformerCard } from "src/components/Performers/PerformerCard";
import { sortPerformers } from "src/core/performers";
import { FormattedMessage, useIntl } from "react-intl";
import { PhotographerLink } from "src/components/Shared/Link";
import { PatchComponent } from "../../../patch";
interface IImageDetailProps {
  image: GQL.ImageDataFragment;
}

export const ImageDetailPanel: React.FC<IImageDetailProps> = PatchComponent(
  "ImageDetailPanel",
  (props) => {
    const intl = useIntl();

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

    function renderDetails() {
      if (!props.image.details) return;
      return (
        <Box sx={{ mt: 2, mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            <FormattedMessage id="details" />
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
            {props.image.details}
          </Typography>
        </Box>
      );
    }

    function renderTags() {
      if (props.image.tags.length === 0) return;
      const tags = props.image.tags.map((tag) => (
        <TagLink key={tag.id} tag={tag} linkType="image" />
      ));
      return (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            <FormattedMessage
              id="countables.tags"
              values={{ count: props.image.tags.length }}
            />
          </Typography>
          <Box
            sx={{
              maxHeight: "9rem",
              overflowY: "auto",
              pr: 0.5,
              "&::-webkit-scrollbar": { width: 6 },
              "&::-webkit-scrollbar-thumb": {
                borderRadius: 3,
                bgcolor: "action.hover",
              },
            }}
          >
            {tags}
          </Box>
        </Box>
      );
    }

    function renderPerformers() {
      if (props.image.performers.length === 0) return;
      const performers = sortPerformers(props.image.performers);
      const cards = performers.map((performer) => (
        <PerformerCard
          key={performer.id}
          performer={performer}
          ageFromDate={props.image.date ?? undefined}
        />
      ));
      return (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            <FormattedMessage
              id="countables.performers"
              values={{ count: props.image.performers.length }}
            />
          </Typography>
          <Box
            sx={{
              display: "flex",
              overflowX: "auto",
              gap: 2,
              pb: 1,
              scrollSnapType: "x mandatory",
              "&::-webkit-scrollbar": { height: 6 },
              "&::-webkit-scrollbar-thumb": {
                borderRadius: 3,
                bgcolor: "action.hover",
              },
              "& .performer-card": {
                flex: "0 0 auto",
                width: "15rem",
                scrollSnapAlign: "start",
              },
              "& .performer-card-image": { height: "22.5rem" },
            }}
          >
            {cards}
          </Box>
        </Box>
      );
    }

    function renderGalleries() {
      if (props.image.galleries.length === 0) return;
      const galleries = props.image.galleries.map((gallery) => (
        <GalleryLink key={gallery.id} gallery={gallery} />
      ));
      return (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            <FormattedMessage
              id="countables.galleries"
              values={{ count: props.image.galleries.length }}
            />
          </Typography>
          {galleries}
        </Box>
      );
    }

    return (
      <>
        <Box>
          <Divider sx={{ my: 1 }} />
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={labelSx}>
                  <FormattedMessage id="created_at" />
                </TableCell>
                <TableCell sx={valueSx}>
                  {TextUtils.formatDateTime(intl, props.image.created_at)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={labelSx}>
                  <FormattedMessage id="updated_at" />
                </TableCell>
                <TableCell sx={valueSx}>
                  {TextUtils.formatDateTime(intl, props.image.updated_at)}
                </TableCell>
              </TableRow>
              {props.image.code && (
                <TableRow>
                  <TableCell sx={labelSx}>
                    <FormattedMessage id="scene_code" />
                  </TableCell>
                  <TableCell sx={valueSx}>{props.image.code}</TableCell>
                </TableRow>
              )}
              {props.image.photographer && (
                <TableRow>
                  <TableCell sx={labelSx}>
                    <FormattedMessage id="photographer" />
                  </TableCell>
                  <TableCell sx={valueSx}>
                    <PhotographerLink
                      photographer={props.image.photographer}
                      linkType="image"
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
        <Box>
          {renderDetails()}
          {renderGalleries()}
          {renderTags()}
          {renderPerformers()}
        </Box>
      </>
    );
  }
);
