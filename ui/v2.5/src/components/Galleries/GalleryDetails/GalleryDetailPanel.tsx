import React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "react-router-dom";
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
import { TagLink } from "src/components/Shared/TagLink";
import { PerformerCard } from "src/components/Performers/PerformerCard";
import { sortPerformers } from "src/core/performers";
import { PhotographerLink } from "src/components/Shared/Link";

import { PatchComponent } from "src/patch";

interface IGalleryDetailProps {
  gallery: GQL.GalleryDataFragment;
}

export const GalleryDetailPanel: React.FC<IGalleryDetailProps> = PatchComponent(
  "GalleryDetailPanel",
  (props) => {
    const intl = useIntl();
    const { gallery } = props;

    function renderDetails() {
      if (!gallery.details) return;
      return (
        <Box sx={{ mt: 2, mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            <FormattedMessage id="details" />
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
            {gallery.details}
          </Typography>
        </Box>
      );
    }

    function renderTags() {
      if (gallery.tags.length === 0) return;
      const tags = gallery.tags.map((tag) => (
        <TagLink key={tag.id} tag={tag} linkType="gallery" />
      ));
      return (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            <FormattedMessage
              id="countables.tags"
              values={{ count: gallery.tags.length }}
            />
          </Typography>
          <Box
            sx={{
              maxHeight: "9rem",
              overflowY: "auto",
              pr: 0.5,
              '&::-webkit-scrollbar': { width: 6 },
              '&::-webkit-scrollbar-thumb': {
                borderRadius: 3,
                bgcolor: 'action.hover',
              },
            }}
          >
            {tags}
          </Box>
        </Box>
      );
    }

    function renderStudio() {
      if (!gallery.studio) return;
      const { studio } = gallery;

      // Exclude the default placeholder image (URL contains ?default=true)
      const hasLogo =
        !!studio.image_path &&
        !studio.image_path.includes("default=true");

      return (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            <FormattedMessage id="studio" />
          </Typography>
          <Link
            to={`/studios/${studio.id}`}
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            {hasLogo ? (
              <Box sx={{ height: "8rem" }}>
                <Box
                  component="img"
                  src={studio.image_path ?? ""}
                  alt={studio.name}
                  sx={{
                    height: "100%",
                    maxWidth: "100%",
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              </Box>
            ) : (
              <Typography variant="body2" color="primary">
                {studio.name}
              </Typography>
            )}
          </Link>
        </Box>
      );
    }

    function renderPerformers() {
      if (gallery.performers.length === 0) return;
      const performers = sortPerformers(gallery.performers);
      const cards = performers.map((performer) => (
        <PerformerCard
          key={performer.id}
          performer={performer}
          ageFromDate={gallery.date ?? undefined}
        />
      ));

      return (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            <FormattedMessage
              id="countables.performers"
              values={{ count: gallery.performers.length }}
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
                  {TextUtils.formatDateTime(intl, gallery.created_at)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={labelSx}>
                  <FormattedMessage id="updated_at" />
                </TableCell>
                <TableCell sx={valueSx}>
                  {TextUtils.formatDateTime(intl, gallery.updated_at)}
                </TableCell>
              </TableRow>
              {gallery.code && (
                <TableRow>
                  <TableCell sx={labelSx}>
                    <FormattedMessage id="scene_code" />
                  </TableCell>
                  <TableCell sx={valueSx}>{gallery.code}</TableCell>
                </TableRow>
              )}
              {gallery.photographer && (
                <TableRow>
                  <TableCell sx={labelSx}>
                    <FormattedMessage id="photographer" />
                  </TableCell>
                  <TableCell sx={valueSx}>
                    <PhotographerLink
                      photographer={gallery.photographer}
                      linkType="gallery"
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
        <Box>
          {renderTags()}
          {renderStudio()}
          {renderPerformers()}
        </Box>
      </>
    );
  }
);
