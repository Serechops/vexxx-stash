import { Button, Tabs, Tab, Box, FormControlLabel, Switch } from "@mui/material";
import { Row, Col } from "src/components/Shared/Layouts";
import React, { useEffect, useMemo, useState } from "react";
import { useHistory, Redirect, RouteComponentProps } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet";
import cx from "classnames";
import Mousetrap from "mousetrap";

import * as GQL from "src/core/generated-graphql";
import {
  useFindTag,
  useTagUpdate,
  useTagDestroy,
  mutateMetadataAutoTag,
} from "src/core/StashService";
import { DetailsEditNavbar } from "src/components/Shared/DetailsEditNavbar";
import { ErrorMessage } from "src/components/Shared/ErrorMessage";
import { ModalComponent } from "src/components/Shared/Modal";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { useToast } from "src/hooks/Toast";
import { useConfigurationContext } from "src/hooks/Config";
import { tagRelationHook } from "src/core/tags";
import { TagScenesPanel } from "./TagScenesPanel";
import { TagMarkersPanel } from "./TagMarkersPanel";
import { TagImagesPanel } from "./TagImagesPanel";
import { TagPerformersPanel } from "./TagPerformersPanel";
import { TagStudiosPanel } from "./TagStudiosPanel";
import { TagGalleriesPanel } from "./TagGalleriesPanel";
import { CompressedTagDetailsPanel, TagDetailsPanel } from "./TagDetailsPanel";
import { TagEditPanel } from "./TagEditPanel";
import { TagMergeModal } from "../TagMergeDialog";
import { faTrashAlt } from "@fortawesome/free-solid-svg-icons";
import { DetailImage } from "src/components/Shared/DetailImage";
import { useLoadStickyHeader } from "src/hooks/detailsPanel";
import { useScrollToTopOnMount } from "src/hooks/scrollToTop";
import { TagGroupsPanel } from "./TagGroupsPanel";
import { BackgroundImage } from "src/components/Shared/DetailsPage/BackgroundImage";
import {
  TabTitleCounter,
  useTabKey,
} from "src/components/Shared/DetailsPage/Tabs";
import { DetailTitle } from "src/components/Shared/DetailsPage/DetailTitle";
import { ExpandCollapseButton } from "src/components/Shared/CollapseButton";
import { FavoriteIcon } from "src/components/Shared/FavoriteIcon";
import { AliasList } from "src/components/Shared/DetailsPage/AliasList";
import { HeaderImage } from "src/components/Shared/DetailsPage/HeaderImage";
import { goBackOrReplace } from "src/utils/history";

interface IProps {
  tag: GQL.TagDataFragment;
  tabKey?: TabKey;
}

interface ITagParams {
  id: string;
  tab?: string;
}

const validTabs = [
  "default",
  "scenes",
  "images",
  "galleries",
  "groups",
  "markers",
  "performers",
  "studios",
] as const;
type TabKey = (typeof validTabs)[number];

function isTabKey(tab: string): tab is TabKey {
  return validTabs.includes(tab as TabKey);
}

const TagTabs: React.FC<{
  tabKey?: TabKey;
  tag: GQL.TagDataFragment;
  abbreviateCounter: boolean;
  showAllCounts?: boolean;
}> = ({ tabKey, tag, abbreviateCounter, showAllCounts = false }) => {
  const [showAllDetails, setShowAllDetails] = useState<boolean>(
    showAllCounts && tag.children.length > 0
  );

  const sceneCount =
    (showAllDetails ? tag.scene_count_all : tag.scene_count) ?? 0;
  const imageCount =
    (showAllDetails ? tag.image_count_all : tag.image_count) ?? 0;
  const galleryCount =
    (showAllDetails ? tag.gallery_count_all : tag.gallery_count) ?? 0;
  const groupCount =
    (showAllDetails ? tag.group_count_all : tag.group_count) ?? 0;
  const sceneMarkerCount =
    (showAllDetails ? tag.scene_marker_count_all : tag.scene_marker_count) ?? 0;
  const performerCount =
    (showAllDetails ? tag.performer_count_all : tag.performer_count) ?? 0;
  const studioCount =
    (showAllDetails ? tag.studio_count_all : tag.studio_count) ?? 0;

  const populatedDefaultTab = useMemo(() => {
    let ret: TabKey = "scenes";
    if (sceneCount == 0) {
      if (imageCount != 0) {
        ret = "images";
      } else if (galleryCount != 0) {
        ret = "galleries";
      } else if (groupCount != 0) {
        ret = "groups";
      } else if (sceneMarkerCount != 0) {
        ret = "markers";
      } else if (performerCount != 0) {
        ret = "performers";
      } else if (studioCount != 0) {
        ret = "studios";
      }
    }

    return ret;
  }, [
    sceneCount,
    imageCount,
    galleryCount,
    sceneMarkerCount,
    performerCount,
    studioCount,
    groupCount,
  ]);

  const { setTabKey } = useTabKey({
    tabKey,
    validTabs,
    defaultTabKey: populatedDefaultTab,
    baseURL: `/tags/${tag.id}`,
  });

  const contentSwitch = useMemo(() => {
    if (tag.children.length === 0) {
      return null;
    }

    return (
      <div className="item-list-header">
        <div className="item-list-header">
          <FormControlLabel
            control={
              <Switch
                id="showSubContent"
                checked={showAllDetails}
                onChange={() => setShowAllDetails(!showAllDetails)}
              />
            }
            label={<FormattedMessage id="include_sub_tag_content" />}
          />
        </div>
      </div>
    );
  }, [showAllDetails, tag.children.length]);

  return (
    <Box sx={{ width: "100%" }}>
      <Tabs
        id="tag-tabs"
        value={tabKey}
        onChange={(_, newValue) => setTabKey(newValue)}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab
          value="scenes"
          label={
            <TabTitleCounter
              messageID="scenes"
              count={sceneCount}
              abbreviateCounter={abbreviateCounter}
            />
          }
        />
        <Tab
          value="images"
          label={
            <TabTitleCounter
              messageID="images"
              count={imageCount}
              abbreviateCounter={abbreviateCounter}
            />
          }
        />
        <Tab
          value="galleries"
          label={
            <TabTitleCounter
              messageID="galleries"
              count={galleryCount}
              abbreviateCounter={abbreviateCounter}
            />
          }
        />
        <Tab
          value="groups"
          label={
            <TabTitleCounter
              messageID="groups"
              count={groupCount}
              abbreviateCounter={abbreviateCounter}
            />
          }
        />
        <Tab
          value="markers"
          label={
            <TabTitleCounter
              messageID="markers"
              count={sceneMarkerCount}
              abbreviateCounter={abbreviateCounter}
            />
          }
        />
        <Tab
          value="performers"
          label={
            <TabTitleCounter
              messageID="performers"
              count={performerCount}
              abbreviateCounter={abbreviateCounter}
            />
          }
        />
        <Tab
          value="studios"
          label={
            <TabTitleCounter
              messageID="studios"
              count={studioCount}
              abbreviateCounter={abbreviateCounter}
            />
          }
        />
      </Tabs>

      {tabKey === "scenes" && (
        <Box>
          {contentSwitch}
          <TagScenesPanel
            active={tabKey === "scenes"}
            tag={tag}
            showSubTagContent={showAllDetails}
          />
        </Box>
      )}
      {tabKey === "images" && (
        <Box>
          {contentSwitch}
          <TagImagesPanel
            active={tabKey === "images"}
            tag={tag}
            showSubTagContent={showAllDetails}
          />
        </Box>
      )}
      {tabKey === "galleries" && (
        <Box>
          {contentSwitch}
          <TagGalleriesPanel
            active={tabKey === "galleries"}
            tag={tag}
            showSubTagContent={showAllDetails}
          />
        </Box>
      )}
      {tabKey === "groups" && (
        <Box>
          {contentSwitch}
          <TagGroupsPanel
            active={tabKey === "groups"}
            tag={tag}
            showSubTagContent={showAllDetails}
          />
        </Box>
      )}
      {tabKey === "markers" && (
        <Box>
          {contentSwitch}
          <TagMarkersPanel
            active={tabKey === "markers"}
            tag={tag}
            showSubTagContent={showAllDetails}
          />
        </Box>
      )}
      {tabKey === "performers" && (
        <Box>
          {contentSwitch}
          <TagPerformersPanel
            active={tabKey === "performers"}
            tag={tag}
            showSubTagContent={showAllDetails}
          />
        </Box>
      )}
      {tabKey === "studios" && (
        <Box>
          {contentSwitch}
          <TagStudiosPanel
            active={tabKey === "studios"}
            tag={tag}
            showSubTagContent={showAllDetails}
          />
        </Box>
      )}
    </Box>
  );
};

const TagPage: React.FC<IProps> = ({ tag, tabKey }) => {
  const history = useHistory();
  const Toast = useToast();
  const intl = useIntl();

  // Configuration settings
  const { configuration } = useConfigurationContext();
  const uiConfig = configuration?.ui;
  const abbreviateCounter = uiConfig?.abbreviateCounters ?? false;
  const enableBackgroundImage = uiConfig?.enableTagBackgroundImage ?? false;
  const showAllDetails = uiConfig?.showAllDetails ?? true;
  const compactExpandedDetails = uiConfig?.compactExpandedDetails ?? false;

  const [collapsed, setCollapsed] = useState<boolean>(!showAllDetails);
  const loadStickyHeader = useLoadStickyHeader();

  // Editing state
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState<boolean>(false);
  const [isMerging, setIsMerging] = useState<boolean>(false);

  // Editing tag state
  const [image, setImage] = useState<string | null>();
  const [encodingImage, setEncodingImage] = useState<boolean>(false);

  const [updateTag] = useTagUpdate();
  const [deleteTag] = useTagDestroy({ id: tag.id });

  const showAllCounts = uiConfig?.showChildTagContent;

  const tagImage = useMemo(() => {
    let existingImage = tag.image_path;
    if (isEditing) {
      if (image === null && existingImage) {
        const tagImageURL = new URL(existingImage);
        tagImageURL.searchParams.set("default", "true");
        return tagImageURL.toString();
      } else if (image) {
        return image;
      }
    }

    return existingImage;
  }, [isEditing, tag.image_path, image]);

  function setFavorite(v: boolean) {
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

  // set up hotkeys
  useEffect(() => {
    Mousetrap.bind("e", () => toggleEditing());
    Mousetrap.bind("d d", () => {
      setIsDeleteAlertOpen(true);
    });
    Mousetrap.bind(",", () => setCollapsed(!collapsed));
    Mousetrap.bind("f", () => setFavorite(!tag.favorite));

    return () => {
      if (isEditing) {
        Mousetrap.unbind("s s");
      }

      Mousetrap.unbind("e");
      Mousetrap.unbind("d d");
      Mousetrap.unbind(",");
      Mousetrap.unbind("f");
    };
  });

  async function onSave(input: GQL.TagCreateInput) {
    const oldRelations = {
      parents: tag.parents ?? [],
      children: tag.children ?? [],
    };
    const result = await updateTag({
      variables: {
        input: {
          id: tag.id,
          ...input,
        },
      },
    });
    if (result.data?.tagUpdate) {
      toggleEditing(false);
      const updated = result.data.tagUpdate;
      tagRelationHook(updated, oldRelations, {
        parents: updated.parents,
        children: updated.children,
      });
      Toast.success(
        intl.formatMessage(
          { id: "toast.updated_entity" },
          { entity: intl.formatMessage({ id: "tag" }).toLocaleLowerCase() }
        )
      );
    }
  }

  async function onAutoTag() {
    if (!tag.id) return;
    try {
      await mutateMetadataAutoTag({ tags: [tag.id] });
      Toast.success(intl.formatMessage({ id: "Started Auto-Tagging..." }));
    } catch (e) {
      Toast.error(e);
    }
  }

  async function onDelete() {
    try {
      const oldRelations = {
        parents: tag.parents ?? [],
        children: tag.children ?? [],
      };
      await deleteTag();
      tagRelationHook(tag as GQL.TagDataFragment, oldRelations, {
        parents: [],
        children: [],
      });
    } catch (e) {
      Toast.error(e);
      return;
    }

    goBackOrReplace(history, "/tags");
  }

  function renderDeleteAlert() {
    return (
      <ModalComponent
        show={isDeleteAlertOpen}
        icon={faTrashAlt}
        accept={{
          text: intl.formatMessage({ id: "actions.delete" }),
          variant: "danger",
          onClick: onDelete,
        }}
        cancel={{ onClick: () => setIsDeleteAlertOpen(false) }}
      >
        <p>
          <FormattedMessage
            id="dialogs.delete_confirm"
            values={{
              entityName:
                tag.name ??
                intl.formatMessage({ id: "tag" }).toLocaleLowerCase(),
            }}
          />
        </p>
      </ModalComponent>
    );
  }

  function toggleEditing(value?: boolean) {
    if (value !== undefined) {
      setIsEditing(value);
    } else {
      setIsEditing((e) => !e);
    }
    setImage(undefined);
  }

  function renderMergeButton() {
    return (
      <Button variant="contained" color="secondary" onClick={() => setIsMerging(true)}>
        <FormattedMessage id="actions.merge" />
        ...
      </Button>
    );
  }

  function renderMergeDialog() {
    if (!tag.id) return;
    return (
      <TagMergeModal
        show={isMerging}
        onClose={(mergedId) => {
          setIsMerging(false);
          if (mergedId !== undefined && mergedId !== tag.id) {
            // By default, the merge destination is the current tag, but
            // the user can change it, in which case we need to redirect.
            history.replace(`/tags/${mergedId}`);
          }
        }}
        tags={[tag]}
      />
    );
  }

  const headerClassName = cx("detail-header", {
    edit: isEditing,
    collapsed,
    "full-width": !collapsed && !compactExpandedDetails,
  });

  return (
    <Box
      id="tag-page"
      sx={{
        display: "flex",
        flexWrap: "wrap",
        mx: -1.5,
      }}
    >
      <Helmet>
        <title>{tag.name}</title>
      </Helmet>

      <Box
        className={headerClassName}
        sx={{
          width: "100%",
          position: "relative",
          mb: 4,
          "&.collapsed": {
            "& .logo": {
              maxHeight: "200px",
            },
          },
          "&.full-width": {
            maxWidth: "100%",
          },
        }}
      >
        <BackgroundImage
          imagePath={tag.image_path ?? undefined}
          show={enableBackgroundImage && !isEditing}
        />
        <Box
          className="detail-container"
          sx={{
            px: { xs: 2, sm: 4, md: 5 },
            py: 4,
          }}
        >
          <HeaderImage encodingImage={encodingImage}>
            {tagImage && (
              <Box
                sx={{
                  mb: 4,
                  "& .logo": {
                    maxHeight: "50vh",
                    maxWidth: "100%",
                    objectFit: "contain",
                  },
                }}
              >
                <DetailImage className="logo" alt={tag.name} src={tagImage} />
              </Box>
            )}
          </HeaderImage>
          <Box className="row">
            <Box
              className="tag-head col"
              sx={{
                "& .name-icons": {
                  display: "inline-flex",
                  alignItems: "center",
                  ml: 2,
                  verticalAlign: "middle",
                  "& .not-favorite": {
                    color: "rgba(191, 204, 214, 0.5)",
                  },
                  "& .favorite": {
                    color: "#ff7373",
                  },
                },
              }}
            >
              <DetailTitle name={tag.name} classNamePrefix="tag">
                {!isEditing && (
                  <ExpandCollapseButton
                    collapsed={collapsed}
                    setCollapsed={(v) => setCollapsed(v)}
                  />
                )}
                <span className="name-icons">
                  <FavoriteIcon
                    favorite={tag.favorite}
                    onToggleFavorite={(v) => setFavorite(v)}
                  />
                </span>
              </DetailTitle>

              <AliasList aliases={tag.aliases} />
              {!isEditing && (
                <TagDetailsPanel
                  tag={tag}
                  collapsed={collapsed}
                  fullWidth={!collapsed && !compactExpandedDetails}
                />
              )}
              {isEditing ? (
                <TagEditPanel
                  tag={tag}
                  onSubmit={onSave}
                  onCancel={() => toggleEditing()}
                  onDelete={onDelete}
                  setImage={setImage}
                  setEncodingImage={setEncodingImage}
                />
              ) : (
                <DetailsEditNavbar
                  objectName={tag.name}
                  isNew={false}
                  isEditing={isEditing}
                  onToggleEdit={() => toggleEditing()}
                  onSave={() => { }}
                  onImageChange={() => { }}
                  onClearImage={() => { }}
                  onAutoTag={onAutoTag}
                  autoTagDisabled={tag.ignore_auto_tag}
                  onDelete={onDelete}
                  classNames="mb-2"
                  customButtons={renderMergeButton()}
                />
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {!isEditing && loadStickyHeader && (
        <CompressedTagDetailsPanel tag={tag} />
      )}

      <Box className="detail-body" sx={{ width: "100%", px: { xs: 2, sm: 4, md: 5 } }}>
        <Box className="tag-body">
          <Box className="tag-tabs">
            {!isEditing && (
              <TagTabs
                tabKey={tabKey}
                tag={tag}
                abbreviateCounter={abbreviateCounter}
                showAllCounts={showAllCounts}
              />
            )}
          </Box>
        </Box>
      </Box>
      {renderDeleteAlert()}
      {renderMergeDialog()}
    </Box>
  );
};

const TagLoader: React.FC<RouteComponentProps<ITagParams>> = ({
  location,
  match,
}) => {
  const { id, tab } = match.params;
  const { data, loading, error } = useFindTag(id);

  useScrollToTopOnMount();

  if (loading) return <LoadingIndicator />;
  if (error) return <ErrorMessage error={error.message} />;
  if (!data?.findTag)
    return <ErrorMessage error={`No tag found with id ${id}.`} />;

  if (tab && !isTabKey(tab)) {
    return (
      <Redirect
        to={{
          ...location,
          pathname: `/tags/${id}`,
        }}
      />
    );
  }

  return <TagPage tag={data.findTag} tabKey={tab as TabKey | undefined} />;
};

export default TagLoader;
