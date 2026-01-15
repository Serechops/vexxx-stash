import React from "react";
import { Link } from "react-router-dom";
import { Box } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { PatchComponent } from "src/patch";
import { TagLink } from "src/components/Shared/TagLink";
import { StashIDPill } from "src/components/Shared/StashID";
import { DetailItem } from "src/components/Shared/DetailItem";

interface IStudioDetailsPanel {
  studio: GQL.StudioDataFragment;
  collapsed?: boolean;
  fullWidth?: boolean;
}

export const StudioDetailsPanel: React.FC<IStudioDetailsPanel> = PatchComponent(
  "StudioDetailsPanel",
  ({ studio, fullWidth, collapsed }) => {
    function renderTagsField() {
      if (!studio.tags.length) {
        return;
      }
      return (
        <Box component="ul" sx={{ pl: 0, mb: 0, listStyle: "none" }}>
          {(studio.tags ?? []).map((tag) => (
            <TagLink key={tag.id} linkType="studio" tag={tag} />
          ))}
        </Box>
      );
    }

    function renderStashIDs() {
      if (!studio.stash_ids?.length) {
        return;
      }

      return (
        <Box component="ul" sx={{ pl: 0, mb: 0, listStyle: "none" }}>
          {studio.stash_ids.map((stashID) => {
            return (
              <Box component="li" key={stashID.stash_id} sx={{ display: "flex", flexWrap: "nowrap" }}>
                <StashIDPill stashID={stashID} linkType="studios" />
              </Box>
            );
          })}
        </Box>
      );
    }

    function renderURLs() {
      if (!studio.urls?.length) {
        return;
      }

      return (
        <Box component="ul" sx={{ pl: 0, mb: 0, listStyle: "none" }}>
          {studio.urls.map((url) => (
            <Box component="li" key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            </Box>
          ))}
        </Box>
      );
    }

    return (
      <Box
        className="detail-group"
        sx={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          py: 2
        }}
      >
        <DetailItem id="details" value={studio.details} fullWidth={fullWidth} />
        <DetailItem id="urls" value={renderURLs()} fullWidth={fullWidth} />
        <DetailItem
          id="parent_studios"
          value={
            studio.parent_studio?.name ? (
              <Link to={`/studios/${studio.parent_studio?.id}`}>
                {studio.parent_studio.name}
              </Link>
            ) : (
              ""
            )
          }
          fullWidth={fullWidth}
        />
        <DetailItem id="tags" value={renderTagsField()} fullWidth={fullWidth} />
        {!collapsed && (
          <DetailItem
            id="stash_ids"
            value={renderStashIDs()}
            fullWidth={fullWidth}
          />
        )}
      </Box>
    );
  }
);

export const CompressedStudioDetailsPanel: React.FC<IStudioDetailsPanel> = ({
  studio,
}) => {
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <Box
      className="sticky detail-header"
      sx={{
        display: { xs: "none", sm: "block" },
        minHeight: "50px",
        position: "fixed",
        top: "48.75px",
        zIndex: 10,
        bgcolor: "background.paper",
        width: "100%"
      }}
    >
      <Box
        className="sticky detail-header-group"
        sx={{
          padding: "1rem 2.5rem",
          "& a.studio-name": {
            color: "#f5f8fa",
            cursor: "pointer",
            fontWeight: 800,
          },
          "& a, & span": {
            color: "#d7d9db",
            fontWeight: 600,
            pr: 1
          },
          "& .detail-divider": {
            fontSize: "1rem",
            fontWeight: 400,
            opacity: 0.6
          }
        }}
      >
        <a className="studio-name" onClick={() => scrollToTop()}>
          {studio.name}
        </a>
        {studio?.parent_studio?.name ? (
          <>
            <span className="detail-divider">/</span>
            <span className="studio-parent">{studio?.parent_studio?.name}</span>
          </>
        ) : (
          ""
        )}
      </Box>
    </Box>
  );
};
