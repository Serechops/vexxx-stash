import { Tabs, Tab, Box, FormControlLabel, Switch } from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import { useHistory, Redirect, RouteComponentProps } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet";
import cx from "classnames";
import Mousetrap from "mousetrap";

import * as GQL from "src/core/generated-graphql";
import {
  useFindStudio,
  useStudioUpdate,
  useStudioDestroy,
  mutateMetadataAutoTag,
} from "src/core/StashService";
import { DetailsEditNavbar } from "src/components/Shared/DetailsEditNavbar";
import { ModalComponent } from "src/components/Shared/Modal";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { ErrorMessage } from "src/components/Shared/ErrorMessage";
import { useToast } from "src/hooks/Toast";
import { useConfigurationContext } from "src/hooks/Config";
import { StudioScenesPanel } from "./StudioScenesPanel";
import { StudioMissingScenesPanel } from "./StudioMissingScenesPanel";
import { StudioGalleriesPanel } from "./StudioGalleriesPanel";
import { StudioImagesPanel } from "./StudioImagesPanel";
import { StudioChildrenPanel } from "./StudioChildrenPanel";
import { StudioPerformersPanel } from "./StudioPerformersPanel";
import { StudioEditPanel } from "./StudioEditPanel";
import {
  CompressedStudioDetailsPanel,
  StudioDetailsPanel,
} from "./StudioDetailsPanel";
import { StudioGroupsPanel } from "./StudioGroupsPanel";
import { faTrashAlt } from "@fortawesome/free-solid-svg-icons";
import { RatingSystem } from "src/components/Shared/Rating/RatingSystem";
import { DetailImage } from "src/components/Shared/DetailImage";
import { useRatingKeybinds } from "src/hooks/keybinds";
import { useLoadStickyHeader } from "src/hooks/detailsPanel";
import { useScrollToTopOnMount } from "src/hooks/scrollToTop";
import { BackgroundImage } from "src/components/Shared/DetailsPage/BackgroundImage";
import {
  TabTitleCounter,
  useTabKey,
} from "src/components/Shared/DetailsPage/Tabs";
import { DetailTitle } from "src/components/Shared/DetailsPage/DetailTitle";
import { ExpandCollapseButton } from "src/components/Shared/CollapseButton";
import { FavoriteIcon } from "src/components/Shared/FavoriteIcon";
import { ExternalLinkButtons } from "src/components/Shared/ExternalLinksButton";
import { AliasList } from "src/components/Shared/DetailsPage/AliasList";
import { HeaderImage } from "src/components/Shared/DetailsPage/HeaderImage";
import { goBackOrReplace } from "src/utils/history";
import { OCounterButton } from "src/components/Shared/CountButton";

interface IProps {
  studio: GQL.StudioDataFragment;
  tabKey?: TabKey;
}

interface IStudioParams {
  id: string;
  tab?: string;
}

const validTabs = [
  "default",
  "scenes",
  "galleries",
  "images",
  "performers",
  "groups",
  "missing",
  "childstudios",
] as const;
type TabKey = (typeof validTabs)[number];

function isTabKey(tab: string): tab is TabKey {
  return validTabs.includes(tab as TabKey);
}

const StudioTabs: React.FC<{
  tabKey?: TabKey;
  studio: GQL.StudioDataFragment;
  abbreviateCounter: boolean;
  showAllCounts?: boolean;
}> = ({ tabKey, studio, abbreviateCounter, showAllCounts = false }) => {
  const [showAllDetails, setShowAllDetails] = useState<boolean>(
    showAllCounts && studio.child_studios.length > 0
  );

  const sceneCount =
    (showAllDetails ? studio.scene_count_all : studio.scene_count) ?? 0;
  const galleryCount =
    (showAllDetails ? studio.gallery_count_all : studio.gallery_count) ?? 0;
  const imageCount =
    (showAllDetails ? studio.image_count_all : studio.image_count) ?? 0;
  const performerCount =
    (showAllDetails ? studio.performer_count_all : studio.performer_count) ?? 0;
  const groupCount =
    (showAllDetails ? studio.group_count_all : studio.group_count) ?? 0;

  const populatedDefaultTab = useMemo(() => {
    let ret: TabKey = "scenes";
    if (sceneCount == 0) {
      if (galleryCount != 0) {
        ret = "galleries";
      } else if (imageCount != 0) {
        ret = "images";
      } else if (performerCount != 0) {
        ret = "performers";
      } else if (groupCount != 0) {
        ret = "groups";
      } else if (studio.child_studios.length != 0) {
        ret = "childstudios";
      }
    }

    return ret;
  }, [
    sceneCount,
    galleryCount,
    imageCount,
    performerCount,
    groupCount,
    studio,
  ]);

  const { setTabKey } = useTabKey({
    tabKey,
    validTabs,
    defaultTabKey: populatedDefaultTab,
    baseURL: `/studios/${studio.id}`,
  });

  const contentSwitch = useMemo(() => {
    if (!studio.child_studios.length) {
      return null;
    }

    return (
      <Box className="item-list-header">
        <FormControlLabel
          control={
            <Switch
              checked={showAllDetails}
              onChange={() => setShowAllDetails(!showAllDetails)}
              id="showSubContent"
            />
          }
          label={<FormattedMessage id="include_sub_studio_content" />}
        />
      </Box>
    );
  }, [showAllDetails, studio.child_studios.length]);

  // Query potential scenes count for missing scenes tab
  const { data: potentialData } = GQL.useFindPotentialScenesQuery({
    variables: {
      filter: {
        studio_stash_id: studio.stash_ids?.[0]?.stash_id
      }
    },
    skip: !studio.stash_ids || studio.stash_ids.length === 0,
  });

  // Count only scenes that are NOT owned (truly missing from library)
  const missingSceneCount = useMemo(() => {
    if (!potentialData?.findPotentialScenes) return 0;
    return potentialData.findPotentialScenes.filter(ps => !ps.existing_scene?.id).length;
  }, [potentialData]);

  return (
    <>
      <Tabs
        id="studio-tabs"
        value={tabKey}
        onChange={(_, k) => setTabKey(k as TabKey)}
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
          value="childstudios"
          label={
            <TabTitleCounter
              messageID="subsidiary_studios"
              count={studio.child_studios.length}
              abbreviateCounter={abbreviateCounter}
            />
          }
        />
        <Tab
          value="missing"
          label={
            <TabTitleCounter
              messageID="Missing Scenes"
              count={missingSceneCount}
              abbreviateCounter={abbreviateCounter}
            />
          }
        />
      </Tabs>

      {tabKey === "scenes" && (
        <Box>
          {contentSwitch}
          <StudioScenesPanel
            active={true}
            studio={studio}
            showChildStudioContent={showAllDetails}
          />
        </Box>
      )}

      {tabKey === "galleries" && (
        <Box>
          {contentSwitch}
          <StudioGalleriesPanel
            active={true}
            studio={studio}
            showChildStudioContent={showAllDetails}
          />
        </Box>
      )}

      {tabKey === "images" && (
        <Box>
          {contentSwitch}
          <StudioImagesPanel
            active={true}
            studio={studio}
            showChildStudioContent={showAllDetails}
          />
        </Box>
      )}

      {tabKey === "performers" && (
        <Box>
          {contentSwitch}
          <StudioPerformersPanel
            active={true}
            studio={studio}
            showChildStudioContent={showAllDetails}
          />
        </Box>
      )}

      {tabKey === "groups" && (
        <Box>
          {contentSwitch}
          <StudioGroupsPanel
            active={true}
            studio={studio}
            showChildStudioContent={showAllDetails}
          />
        </Box>
      )}

      {tabKey === "childstudios" && (
        <Box>
          <StudioChildrenPanel
            active={true}
            studio={studio}
          />
        </Box>
      )}

      {tabKey === "missing" && (
        <Box>
          <StudioMissingScenesPanel
            active={true}
            studio={studio}
          />
        </Box>
      )}
    </>
  );
};

const StudioPage: React.FC<IProps> = ({ studio, tabKey }) => {
  const history = useHistory();
  const Toast = useToast();
  const intl = useIntl();

  // Configuration settings
  const { configuration } = useConfigurationContext();
  const uiConfig = configuration?.ui;
  const abbreviateCounter = uiConfig?.abbreviateCounters ?? false;
  const enableBackgroundImage = uiConfig?.enableStudioBackgroundImage ?? false;
  const showAllDetails = uiConfig?.showAllDetails ?? true;
  const compactExpandedDetails = uiConfig?.compactExpandedDetails ?? false;

  const [collapsed, setCollapsed] = useState<boolean>(!showAllDetails);
  const loadStickyHeader = useLoadStickyHeader();

  // Editing state
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState<boolean>(false);

  // Editing studio state
  const [image, setImage] = useState<string | null>();
  const [encodingImage, setEncodingImage] = useState<boolean>(false);

  const [updateStudio] = useStudioUpdate();
  const [deleteStudio] = useStudioDestroy({ id: studio.id });

  const showAllCounts = uiConfig?.showChildStudioContent;

  const studioImage = useMemo(() => {
    const existingPath = studio.image_path;
    if (isEditing) {
      if (image === null && existingPath) {
        const studioImageURL = new URL(existingPath);
        studioImageURL.searchParams.set("default", "true");
        return studioImageURL.toString();
      } else if (image) {
        return image;
      }
    }

    return existingPath;
  }, [isEditing, image, studio.image_path]);

  function setFavorite(v: boolean) {
    if (studio.id) {
      updateStudio({
        variables: {
          input: {
            id: studio.id,
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
    Mousetrap.bind("f", () => setFavorite(!studio.favorite));

    return () => {
      Mousetrap.unbind("e");
      Mousetrap.unbind("d d");
      Mousetrap.unbind(",");
      Mousetrap.unbind("f");
    };
  });

  useRatingKeybinds(
    true,
    configuration?.ui.ratingSystemOptions?.type,
    setRating
  );

  async function onSave(input: GQL.StudioCreateInput) {
    await updateStudio({
      variables: {
        input: {
          id: studio.id,
          ...input,
        },
      },
    });
    toggleEditing(false);
    Toast.success(
      intl.formatMessage(
        { id: "toast.updated_entity" },
        { entity: intl.formatMessage({ id: "studio" }).toLocaleLowerCase() }
      )
    );
  }

  async function onAutoTag() {
    if (!studio.id) return;
    try {
      await mutateMetadataAutoTag({ studios: [studio.id] });
      Toast.success(intl.formatMessage({ id: "Started Auto-Tagging..." }));
    } catch (e) {
      Toast.error(e);
    }
  }

  async function onDelete() {
    try {
      await deleteStudio();
    } catch (e) {
      Toast.error(e);
      return;
    }

    goBackOrReplace(history, "/studios");
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
                studio.name ??
                intl.formatMessage({ id: "studio" }).toLocaleLowerCase(),
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

  function setRating(v: number | null) {
    if (studio.id) {
      updateStudio({
        variables: {
          input: {
            id: studio.id,
            rating100: v,
          },
        },
      });
    }
  }

  const headerClassName = cx("detail-header", {
    edit: isEditing,
    collapsed,
    "full-width": !collapsed && !compactExpandedDetails,
  });

  return (
    <Box
      id="studio-page"
      sx={{
        display: "flex",
        flexWrap: "wrap",
        mx: -1.5,
      }}
    >
      <Helmet>
        <title>{studio.name ?? intl.formatMessage({ id: "studio" })}</title>
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
          imagePath={studio.image_path ?? undefined}
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
            {studioImage && (
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
                <DetailImage
                  className="logo"
                  alt={studio.name}
                  src={studioImage}
                />
              </Box>
            )}
          </HeaderImage>
          <Box className="row">
            <Box
              className="studio-head col"
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
              <DetailTitle name={studio.name ?? ""} classNamePrefix="studio">
                {!isEditing && (
                  <ExpandCollapseButton
                    collapsed={collapsed}
                    setCollapsed={(v) => setCollapsed(v)}
                  />
                )}
                <span className="name-icons">
                  <FavoriteIcon
                    favorite={studio.favorite}
                    onToggleFavorite={(v) => setFavorite(v)}
                  />
                  <ExternalLinkButtons urls={studio.urls} />
                </span>
              </DetailTitle>

              <AliasList aliases={studio.aliases} />
              <Box
                className="quality-group"
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  mt: 0.5,
                  "& .rating-stars-precision-full .star-rating-number": {
                    minWidth: "0.75rem",
                  },
                  "& .rating-stars-precision-half .star-rating-number, & .rating-stars-precision-tenth .star-rating-number": {
                    minWidth: "1.45rem",
                  },
                  "& .rating-stars-precision-quarter .star-rating-number": {
                    minWidth: "2rem",
                  },
                }}
              >
                <RatingSystem
                  value={studio.rating100}
                  onSetRating={(value) => setRating(value)}
                  clickToRate
                  withoutContext
                />
                {!!studio.o_counter && (
                  <OCounterButton value={studio.o_counter} />
                )}
              </Box>
              {!isEditing && (
                <StudioDetailsPanel
                  studio={studio}
                  collapsed={collapsed}
                  fullWidth={!collapsed && !compactExpandedDetails}
                />
              )}
              {isEditing ? (
                <StudioEditPanel
                  studio={studio}
                  onSubmit={onSave}
                  onCancel={() => toggleEditing()}
                  onDelete={onDelete}
                  setImage={setImage}
                  setEncodingImage={setEncodingImage}
                />
              ) : (
                <DetailsEditNavbar
                  objectName={
                    studio.name ?? intl.formatMessage({ id: "studio" })
                  }
                  isNew={false}
                  isEditing={isEditing}
                  onToggleEdit={() => toggleEditing()}
                  onSave={() => { }}
                  onImageChange={() => { }}
                  onClearImage={() => { }}
                  onAutoTag={onAutoTag}
                  autoTagDisabled={studio.ignore_auto_tag}
                  onDelete={onDelete}
                />
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {!isEditing && loadStickyHeader && (
        <CompressedStudioDetailsPanel studio={studio} />
      )}

      <Box className="detail-body" sx={{ width: "100%", px: { xs: 2, sm: 4, md: 5 } }}>
        <Box className="studio-body">
          <Box className="studio-tabs">
            {!isEditing && (
              <StudioTabs
                studio={studio}
                tabKey={tabKey}
                abbreviateCounter={abbreviateCounter}
                showAllCounts={showAllCounts}
              />
            )}
          </Box>
        </Box>
      </Box>
      {renderDeleteAlert()}
    </Box>
  );
};

const StudioLoader: React.FC<RouteComponentProps<IStudioParams>> = ({
  location,
  match,
}) => {
  const { id, tab } = match.params;
  const { data, loading, error } = useFindStudio(id);

  useScrollToTopOnMount();

  if (loading) return <LoadingIndicator />;
  if (error) return <ErrorMessage error={error.message} />;
  if (!data?.findStudio)
    return <ErrorMessage error={`No studio found with id ${id}.`} />;

  if (tab && !isTabKey(tab)) {
    return (
      <Redirect
        to={{
          ...location,
          pathname: `/studios/${id}`,
        }}
      />
    );
  }

  return (
    <StudioPage studio={data.findStudio} tabKey={tab as TabKey | undefined} />
  );
};

export default StudioLoader;
