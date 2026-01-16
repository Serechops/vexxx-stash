import { PatchComponent } from "src/patch";
import React from "react";
import { Link } from "react-router-dom";
import { Box, Button, ButtonGroup, IconButton, Typography } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import NavUtils from "src/utils/navigation";
import { FormattedMessage } from "react-intl";
import { TruncatedText } from "../Shared/TruncatedText";
import { GridCard } from "../Shared/GridCard/GridCard";
import { PopoverCountButton } from "../Shared/PopoverCountButton";
import { Icon } from "../Shared/Icon";
import { faHeart } from "@fortawesome/free-solid-svg-icons";
import cx from "classnames";
import { useTagUpdate } from "src/core/StashService";
import { RatingBanner } from "../Shared/RatingBanner";

interface IProps {
  tag: GQL.TagDataFragment | GQL.TagListDataFragment;
  cardWidth?: number;
  zoomIndex: number;
  selecting?: boolean;
  selected?: boolean;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
}

const TagCardPopovers: React.FC<IProps> = PatchComponent(
  "TagCard.Popovers",
  ({ tag }) => {
    return (
      <>
        <hr />
        <ButtonGroup
          className="card-popovers"
          variant="contained"
          size="small"
        >
          <PopoverCountButton
            className="scene-count"
            type="scene"
            count={tag.scene_count}
            url={NavUtils.makeTagScenesUrl(tag)}
            showZero={true}
          />
          <PopoverCountButton
            className="image-count"
            type="image"
            count={tag.image_count}
            url={NavUtils.makeTagImagesUrl(tag)}
            showZero={true}
          />
          <PopoverCountButton
            className="gallery-count"
            type="gallery"
            count={tag.gallery_count}
            url={NavUtils.makeTagGalleriesUrl(tag)}
            showZero={true}
          />
          <PopoverCountButton
            className="group-count"
            type="group"
            count={tag.group_count}
            url={NavUtils.makeTagGroupsUrl(tag)}
            showZero={true}
          />
          <PopoverCountButton
            className="marker-count"
            type="marker"
            count={tag.scene_marker_count}
            url={NavUtils.makeTagSceneMarkersUrl(tag)}
            showZero={true}
          />
          <PopoverCountButton
            className="performer-count"
            type="performer"
            count={tag.performer_count}
            url={NavUtils.makeTagPerformersUrl(tag)}
            showZero={true}
          />
          <PopoverCountButton
            className="studio-count"
            type="studio"
            count={tag.studio_count}
            url={NavUtils.makeTagStudiosUrl(tag)}
            showZero={true}
          />
        </ButtonGroup>
      </>
    );
  }
);

const TagCardOverlays: React.FC<IProps> = PatchComponent(
  "TagCard.Overlays",
  ({ tag }) => {
    const [updateTag] = useTagUpdate();

    function renderFavoriteIcon() {
      return (
        <Link to="" onClick={(e) => e.preventDefault()}>
          <IconButton
            className={cx(
              "minimal",
              "mousetrap",
              "favorite-button",
              tag.favorite ? "favorite" : "not-favorite"
            )}
            onClick={() => onToggleFavorite!(!tag.favorite)}
            color={tag.favorite ? "error" : "default"}
          >
            <Icon icon={faHeart} size="2x" />
          </IconButton>
        </Link>
      );
    }

    function onToggleFavorite(v: boolean) {
      if (tag.id) {
        updateTag({
          variables: {
            input: {
              id: tag.id,
              favorite: v,
            },
          },
        });
      }
    }

    return <>{renderFavoriteIcon()}</>;
  }
);

const TagCardDetails: React.FC<IProps> = PatchComponent(
  "TagCard.Details",
  ({ tag }) => {
    function maybeRenderDescription() {
      if (tag.description) {
        return (
          <TruncatedText
            className="tag-description"
            text={tag.description}
            lineCount={3}
          />
        );
      }
    }

    function maybeRenderParents() {
      if (tag.parents.length === 1) {
        const parent = tag.parents[0];
        return (
          <Box sx={{ mt: 0.5, fontSize: "0.875rem" }}>
            <FormattedMessage
              id="sub_tag_of"
              values={{
                parent: <Link to={`/tags/${parent.id}`}>{parent.name}</Link>,
              }}
            />
          </Box>
        );
      }

      if (tag.parents.length > 1) {
        return (
          <Box sx={{ mt: 0.5, fontSize: "0.875rem" }}>
            <FormattedMessage
              id="sub_tag_of"
              values={{
                parent: (
                  <Link to={NavUtils.makeParentTagsUrl(tag)}>
                    {tag.parents.length}&nbsp;
                    <FormattedMessage
                      id="countables.tags"
                      values={{ count: tag.parents.length }}
                    />
                  </Link>
                ),
              }}
            />
          </Box>
        );
      }
    }

    function maybeRenderChildren() {
      if (tag.children.length > 0) {
        return (
          <Box sx={{ mt: 0.5, fontSize: "0.875rem" }}>
            <FormattedMessage
              id="parent_of"
              values={{
                children: (
                  <Link to={NavUtils.makeChildTagsUrl(tag)}>
                    {tag.children.length}&nbsp;
                    <FormattedMessage
                      id="countables.tags"
                      values={{ count: tag.children.length }}
                    />
                  </Link>
                ),
              }}
            />
          </Box>
        );
      }
    }

    return (
      <Box
        sx={{
          minHeight: "4rem",
          "& .tag-description": {
            mb: 1
          }
        }}
      >
        {maybeRenderDescription()}
        {maybeRenderParents()}
        {maybeRenderChildren()}
      </Box>
    );
  }
);

const TagCardTitle: React.FC<IProps> = PatchComponent(
  "TagCard.Title",
  ({ tag }) => {
    return <>{tag.name ?? ""}</>;
  }
);

export const TagCard: React.FC<IProps> = PatchComponent("TagCard", (props) => {
  const { tag, cardWidth, zoomIndex, selecting, selected, onSelectedChanged } =
    props;

  return (
    <Box
      className={`tag-card zoom-${zoomIndex}`}
      sx={{
        "& .favorite-button": {
          position: "absolute",
          top: 10,
          right: 5,
          p: 0,
          zIndex: 1,
          "&.not-favorite": {
            opacity: 0,
            transition: "opacity 0.2s"
          }
        },
        "&:hover .favorite-button.not-favorite": {
          opacity: 1
        }
      }}
    >
      <GridCard
        className="hover:!scale-100 !transition-none"
        url={`/tags/${tag.id}`}
        width={cardWidth}
        title={<TagCardTitle {...props} />}
        linkClassName="tag-card-header"
        image={
          <Box sx={{ position: "relative", width: "100%", pb: "50%" }}>
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                p: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Box
                component="img"
                loading="lazy"
                alt={tag.name}
                src={tag.image_path ?? ""}
                sx={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                }}
              />
            </Box>
          </Box>
        }
        details={<TagCardDetails {...props} />}
        overlays={<TagCardOverlays {...props} />}
        popovers={<TagCardPopovers {...props} />}
        selected={selected}
        selecting={selecting}
        onSelectedChanged={onSelectedChanged}
      />
    </Box>
  );
});
