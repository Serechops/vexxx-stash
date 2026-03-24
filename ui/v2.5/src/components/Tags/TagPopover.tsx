import { Box, Divider, Tooltip, Typography } from "@mui/material";
import React from "react";
import { FormattedMessage } from "react-intl";
import { Link } from "react-router-dom";
import { ErrorMessage } from "../Shared/ErrorMessage";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { PopoverCountButton } from "../Shared/PopoverCountButton";
import { useFindTag } from "../../core/StashService";
import { useConfigurationContext } from "../../hooks/Config";

interface ITagPopoverCardProps {
  id: string;
}

export const TagPopoverCard: React.FC<ITagPopoverCardProps> = ({ id }) => {
  const { data, loading, error } = useFindTag(id);

  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 1 }}>
        <LoadingIndicator card={true} message={""} />
      </Box>
    );
  if (error) return <ErrorMessage error={error.message} />;
  if (!data?.findTag) return null;

  const tag = data.findTag;

  return (
    <Box sx={{ textAlign: "left" }}>
      {tag.image_path && (
        <Box
          sx={{
            width: "100%",
            height: "5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            mb: 0.75,
            overflow: "hidden",
          }}
        >
          <Box
            component="img"
            src={tag.image_path}
            alt={tag.name}
            sx={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", display: "block" }}
          />
        </Box>
      )}

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.25 }}>
        {tag.name}
      </Typography>

      {tag.description && (
        <Typography
          variant="caption"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            mb: 0.25,
            opacity: 0.8,
          }}
        >
          {tag.description}
        </Typography>
      )}

      {tag.parents.length > 0 && (
        <Typography variant="caption" sx={{ display: "block", mb: 0.25, opacity: 0.7 }}>
          <FormattedMessage
            id="sub_tag_of"
            values={{
              parent:
                tag.parents.length === 1 ? (
                  <Link to={`/tags/${tag.parents[0].id}`} style={{ color: "inherit" }}>
                    {tag.parents[0].name}
                  </Link>
                ) : (
                  <>
                    {tag.parents.length}{" "}
                    <FormattedMessage id="countables.tags" values={{ count: tag.parents.length }} />
                  </>
                ),
            }}
          />
        </Typography>
      )}

      {tag.children.length > 0 && (
        <Typography variant="caption" sx={{ display: "block", mb: 0.25, opacity: 0.7 }}>
          <FormattedMessage
            id="parent_of"
            values={{
              children: (
                <>
                  {tag.children.length}{" "}
                  <FormattedMessage id="countables.tags" values={{ count: tag.children.length }} />
                </>
              ),
            }}
          />
        </Typography>
      )}

      {(tag.scene_count > 0 ||
        tag.image_count > 0 ||
        tag.gallery_count > 0 ||
        tag.performer_count > 0 ||
        tag.scene_marker_count > 0 ||
        tag.group_count > 0 ||
        tag.studio_count > 0) && (
        <>
          <Divider sx={{ my: 0.5, borderColor: "rgba(255,255,255,0.15)" }} />
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              mx: -0.5,
              "& .MuiButton-root": { fontSize: "0.75rem", minWidth: "auto", px: 0.75, py: 0.25 },
              "& svg": { fontSize: "0.8rem", mr: "4px" },
            }}
          >
            <PopoverCountButton type="scene" count={tag.scene_count} url={`/tags/${tag.id}/scenes`} showZero={false} />
            <PopoverCountButton type="image" count={tag.image_count} url={`/tags/${tag.id}/images`} showZero={false} />
            <PopoverCountButton type="gallery" count={tag.gallery_count} url={`/tags/${tag.id}/galleries`} showZero={false} />
            <PopoverCountButton type="performer" count={tag.performer_count} url={`/tags/${tag.id}/performers`} showZero={false} />
            <PopoverCountButton type="marker" count={tag.scene_marker_count} url={`/tags/${tag.id}/markers`} showZero={false} />
            <PopoverCountButton type="group" count={tag.group_count} url={`/tags/${tag.id}/groups`} showZero={false} />
            <PopoverCountButton type="studio" count={tag.studio_count} url={`/tags/${tag.id}/studios`} showZero={false} />
          </Box>
        </>
      )}
    </Box>
  );
};

interface ITagPopoverProps {
  id: string;
  hide?: boolean;
  placement?: "top" | "bottom" | "left" | "right";
  /** @deprecated no longer used — Tooltip anchors to its child automatically */
  target?: React.RefObject<HTMLElement>;
}

export const TagPopover: React.FC<ITagPopoverProps> = ({
  id,
  hide,
  children,
  placement = "top",
}) => {
  const { configuration: config } = useConfigurationContext();

  const showTagCardOnHover = config?.ui.showTagCardOnHover ?? true;

  if (hide || !showTagCardOnHover) {
    return <>{children}</>;
  }

  return (
    <Tooltip
      title={<TagPopoverCard id={id} />}
      placement={placement}
      arrow
      enterDelay={500}
      leaveDelay={100}
      slotProps={{
        tooltip: {
          sx: {
            maxWidth: 260,
            bgcolor: "background.paper",
            color: "text.primary",
            boxShadow: 4,
            p: 1.25,
            "& .MuiTooltip-arrow": {
              color: "background.paper",
            },
          },
        },
      }}
    >
      <span>{children}</span>
    </Tooltip>
  );
};
