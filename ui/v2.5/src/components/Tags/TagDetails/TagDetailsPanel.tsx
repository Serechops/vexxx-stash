import React from "react";
import { Box } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { TagLink } from "src/components/Shared/TagLink";
import { StashIDPill } from "src/components/Shared/StashID";
import { DetailItem } from "src/components/Shared/DetailItem";

interface ITagDetails {
  tag: GQL.TagDataFragment;
  collapsed?: boolean;
  fullWidth?: boolean;
}

export const TagDetailsPanel: React.FC<ITagDetails> = ({ tag, fullWidth, collapsed }) => {
  function renderParentsField() {
    if (!tag.parents?.length) {
      return;
    }

    return (
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {tag.parents.map((p) => (
          <TagLink
            key={p.id}
            tag={p}
            hoverPlacement="bottom"
            linkType="details"
            showHierarchyIcon={p.parent_count !== 0}
            hierarchyTooltipID="tag_parent_tooltip"
          />
        ))}
      </Box>
    );
  }

  function renderChildrenField() {
    if (!tag.children?.length) {
      return;
    }

    return (
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {tag.children.map((c) => (
          <TagLink
            key={c.id}
            tag={c}
            hoverPlacement="bottom"
            linkType="details"
            showHierarchyIcon={c.child_count !== 0}
            hierarchyTooltipID="tag_sub_tag_tooltip"
          />
        ))}
      </Box>
    );
  }

  function renderStashIDs() {
    if (!tag.stash_ids?.length) {
      return;
    }

    return (
      <Box component="ul" sx={{ pl: 0, mb: 0, listStyle: "none" }}>
        {tag.stash_ids.map((stashID) => (
          <Box component="li" key={stashID.stash_id} sx={{ display: "flex", flexWrap: "nowrap" }}>
            <StashIDPill stashID={stashID} linkType="tags" />
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
      <DetailItem
        id="description"
        value={tag.description}
        fullWidth={fullWidth}
      />
      <DetailItem
        id="parent_tags"
        value={renderParentsField()}
        fullWidth={fullWidth}
      />
      <DetailItem
        id="sub_tags"
        value={renderChildrenField()}
        fullWidth={fullWidth}
      />
      {!collapsed && (
        <DetailItem
          id="stash_ids"
          value={renderStashIDs()}
          fullWidth={fullWidth}
        />
      )}
    </Box>
  );
};

export const CompressedTagDetailsPanel: React.FC<ITagDetails> = ({ tag }) => {
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
          "& a.tag-name": {
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
        <a className="tag-name" onClick={() => scrollToTop()}>
          {tag.name}
        </a>
        {tag.description ? (
          <>
            <span className="detail-divider">/</span>
            <span className="tag-desc">{tag.description}</span>
          </>
        ) : (
          ""
        )}
      </Box>
    </Box>
  );
};
