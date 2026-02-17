import React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Box } from "@mui/material";
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
        <>
          <h6>
            <FormattedMessage id="details" />:{" "}
          </h6>
          <p className="pre">{gallery.details}</p>
        </>
      );
    }

    function renderTags() {
      if (gallery.tags.length === 0) return;
      const tags = gallery.tags.map((tag) => (
        <TagLink key={tag.id} tag={tag} linkType="gallery" />
      ));
      return (
        <>
          <h6>
            <FormattedMessage
              id="countables.tags"
              values={{ count: gallery.tags.length }}
            />
          </h6>
          {tags}
        </>
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
        <>
          <h6>
            <FormattedMessage
              id="countables.performers"
              values={{ count: gallery.performers.length }}
            />
          </h6>
          <Box className="flex flex-wrap justify-center" sx={{ '& .performer-card': { width: '15rem' }, '& .performer-card-image': { height: '22.5rem', width: '15rem' } }}>
            {cards}
          </Box>
        </>
      );
    }

    // filename should use entire row if there is no studio
    const galleryDetailsWidth = gallery.studio ? "w-9/12" : "w-full";

    return (
      <>
        <div className="flex flex-wrap">
          <div className={`${galleryDetailsWidth} w-full gallery-details`}>
            <h6>
              <FormattedMessage id="created_at" />:{" "}
              {TextUtils.formatDateTime(intl, gallery.created_at)}{" "}
            </h6>
            <h6>
              <FormattedMessage id="updated_at" />:{" "}
              {TextUtils.formatDateTime(intl, gallery.updated_at)}{" "}
            </h6>
            {gallery.code && (
              <h6>
                <FormattedMessage id="scene_code" />: {gallery.code}{" "}
              </h6>
            )}
            {gallery.photographer && (
              <h6>
                <FormattedMessage id="photographer" />:{" "}
                <PhotographerLink
                  photographer={gallery.photographer}
                  linkType="gallery"
                />
              </h6>
            )}
          </div>
        </div>
        <div className="flex flex-wrap">
          <div className="w-full">
            {renderDetails()}
            {renderTags()}
            {renderPerformers()}
          </div>
        </div>
      </>
    );
  }
);
