import { Menu, MenuItem, IconButton, Typography } from "@mui/material";
import { Tabs, Tab, Box } from "@mui/material";
import Button from "@mui/material/Button";
import { Row, Col } from "src/components/Shared/Layouts";
import React, { useEffect, useMemo, useState } from "react";
import {
  useHistory,
  Link,
  RouteComponentProps,
  Redirect,
} from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet";
import * as GQL from "src/core/generated-graphql";
import {
  mutateMetadataScan,
  mutateResetGalleryCover,
  useFindGallery,
  useGalleryUpdate,
} from "src/core/StashService";
import { ErrorMessage } from "src/components/Shared/ErrorMessage";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { Counter } from "src/components/Shared/Counter";
import Mousetrap from "mousetrap";
import { useGalleryLightbox } from "src/hooks/Lightbox/hooks";
import { useToast } from "src/hooks/Toast";
import { OrganizedButton } from "src/components/Scenes/SceneDetails/OrganizedButton";
import { GalleryEditPanel } from "./GalleryEditPanel";
import { GalleryDetailPanel } from "./GalleryDetailPanel";
import { DeleteGalleriesDialog } from "../DeleteGalleriesDialog";
import { GalleryImagesPanel } from "./GalleryImagesPanel";
import { GalleryAddPanel } from "./GalleryAddPanel";
import { GalleryFileInfoPanel } from "./GalleryFileInfoPanel";
import { GalleryScenesPanel } from "./GalleryScenesPanel";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { galleryPath, galleryTitle } from "src/core/galleries";
import { GalleryChapterPanel } from "./GalleryChaptersPanel";
import { useScrollToTopOnMount } from "src/hooks/scrollToTop";
import { RatingSystem } from "src/components/Shared/Rating/RatingSystem";
import cx from "classnames";
import { useRatingKeybinds } from "src/hooks/keybinds";
import { useConfigurationContext } from "src/hooks/Config";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import { goBackOrReplace } from "src/utils/history";
import { FormattedDate } from "src/components/Shared/Date";

interface IProps {
  gallery: GQL.GalleryDataFragment;
  add?: boolean;
}

interface IGalleryParams {
  id: string;
  tab?: string;
}

export const GalleryPage: React.FC<IProps> = ({ gallery, add }) => {
  const history = useHistory();
  const Toast = useToast();
  const intl = useIntl();
  const { configuration } = useConfigurationContext();
  const showLightbox = useGalleryLightbox(gallery.id, gallery.chapters);


  const [activeTabKey, setActiveTabKey] = useState("gallery-details-panel");
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(menuAnchorEl);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
  };

  const setMainTabKey = (newTabKey: string | null) => {
    if (newTabKey === "add") {
      history.replace(`/galleries/${gallery.id}/add`);
    } else {
      history.replace(`/galleries/${gallery.id}`);
    }
  };

  const path = useMemo(() => galleryPath(gallery), [gallery]);

  const [updateGallery] = useGalleryUpdate();

  const [organizedLoading, setOrganizedLoading] = useState(false);

  async function onSave(input: GQL.GalleryCreateInput) {
    await updateGallery({
      variables: {
        input: {
          id: gallery.id,
          ...input,
        },
      },
    });
    Toast.success(
      intl.formatMessage(
        { id: "toast.updated_entity" },
        { entity: intl.formatMessage({ id: "gallery" }).toLocaleLowerCase() }
      )
    );
  }

  const onOrganizedClick = async () => {
    try {
      setOrganizedLoading(true);
      await updateGallery({
        variables: {
          input: {
            id: gallery.id,
            organized: !gallery.organized,
          },
        },
      });
    } catch (e) {
      Toast.error(e);
    } finally {
      setOrganizedLoading(false);
    }
  };


  async function onRescan() {
    if (!gallery || !path) {
      return;
    }

    await mutateMetadataScan({
      paths: [path],
      rescan: true,
    });

    Toast.success(
      intl.formatMessage(
        { id: "toast.rescanning_entity" },
        {
          count: 1,
          singularEntity: intl.formatMessage({ id: "gallery" }),
        }
      )
    );
  }

  async function onResetCover() {
    try {
      await mutateResetGalleryCover({
        gallery_id: gallery.id!,
      });

      Toast.success(
        intl.formatMessage(
          { id: "toast.updated_entity" },
          {
            entity: intl.formatMessage({ id: "gallery" }).toLocaleLowerCase(),
          }
        )
      );
    } catch (e) {
      Toast.error(e);
    }
  }

  async function onClickChapter(imageindex: number) {
    showLightbox(imageindex - 1);
  }

  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState<boolean>(false);

  function onDeleteDialogClosed(deleted: boolean) {
    setIsDeleteAlertOpen(false);
    if (deleted) {
      goBackOrReplace(history, "/galleries");
    }
  }

  function maybeRenderDeleteDialog() {
    if (isDeleteAlertOpen && gallery) {
      return (
        <DeleteGalleriesDialog
          selected={[{ ...gallery, image_count: NaN }]}
          onClose={onDeleteDialogClosed}
        />
      );
    }
  }

  function renderOperations() {
    return (
      <>
        <IconButton
          id="operation-menu"
          className="minimal"
          title={intl.formatMessage({ id: "operations" })}
          onClick={handleMenuClick}
        >
          <MoreVertIcon />
        </IconButton>
        <Menu
          anchorEl={menuAnchorEl}
          open={menuOpen}
          onClose={handleMenuClose}
          disableScrollLock
          slotProps={{
            paper: {
              sx: {
                bgcolor: "background.paper",
                color: "text.primary",
              },
            },
          }}
        >
          {path && (
            <MenuItem
              onClick={() => {
                onRescan();
                handleMenuClose();
              }}
            >
              <FormattedMessage id="actions.rescan" />
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              onResetCover();
              handleMenuClose();
            }}
          >
            <FormattedMessage id="actions.reset_cover" />
          </MenuItem>
          <MenuItem
            onClick={() => {
              setIsDeleteAlertOpen(true);
              handleMenuClose();
            }}
          >
            <FormattedMessage
              id="actions.delete"
              values={{ entityType: intl.formatMessage({ id: "gallery" }) }}
            />
          </MenuItem>
        </Menu>
      </>
    );
  }

  function renderTabs() {
    if (!gallery) {
      return;
    }

    return (
      <>
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            backgroundColor: "background.paper",
            mx: -2,
            px: 2,
            borderBottom: 1,
            borderColor: "divider",
            mb: 2,
            pt: 1
          }}
        >
          <Tabs
            value={activeTabKey}
            onChange={(_, k) => setActiveTabKey(k)}
            variant="scrollable"
            scrollButtons="auto"
            aria-label="gallery details tabs"
          >
            <Tab label={<FormattedMessage id="details" />} value="gallery-details-panel" />

            {gallery.scenes.length >= 1 ? (
              <Tab
                label={
                  <FormattedMessage
                    id="countables.scenes"
                    values={{ count: gallery.scenes.length }}
                  />
                }
                value="gallery-scenes-panel"
              />
            ) : null}

            {path ? (
              <Tab
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FormattedMessage id="file_info" />
                    <Counter count={gallery.files.length} hideZero hideOne />
                  </Box>
                }
                value="gallery-file-info-panel"
              />
            ) : null}

            <Tab label={<FormattedMessage id="chapters" />} value="gallery-chapter-panel" />
            <Tab label={<FormattedMessage id="actions.edit" />} value="gallery-edit-panel" />
          </Tabs>
        </Box>

        {activeTabKey === "gallery-details-panel" && (
          <GalleryDetailPanel gallery={gallery} />
        )}

        {activeTabKey === "gallery-file-info-panel" && (
          <Box className="file-info-panel">
            <GalleryFileInfoPanel gallery={gallery} />
          </Box>
        )}

        {activeTabKey === "gallery-chapter-panel" && (
          <GalleryChapterPanel
            gallery={gallery}
            onClickChapter={onClickChapter}
            isVisible={activeTabKey === "gallery-chapter-panel"}
          />
        )}

        {activeTabKey === "gallery-edit-panel" && (
          <GalleryEditPanel
            isVisible={activeTabKey === "gallery-edit-panel"}
            gallery={gallery}
            onSubmit={onSave}
            onDelete={() => setIsDeleteAlertOpen(true)}
          />
        )}

        {gallery.scenes.length > 0 && activeTabKey === "gallery-scenes-panel" && (
          <GalleryScenesPanel scenes={gallery.scenes} />
        )}
      </>
    );
  }

  function renderRightTabs() {
    if (!gallery) {
      return;
    }

    return (
      <>
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            backgroundColor: "background.paper",
            mx: -2,
            px: 2,
            borderBottom: 1,
            borderColor: "divider",
            mb: 2,
            pt: 1
          }}
        >
          <Tabs
            value={add ? "add" : "images"}
            onChange={(_, k) => setMainTabKey(k)}
            aria-label="gallery right tabs"
          >
            <Tab label={<FormattedMessage id="images" />} value="images" />
            <Tab label={<FormattedMessage id="actions.add" />} value="add" />
          </Tabs>
        </Box>

        {!add && (
          <GalleryImagesPanel active={!add} gallery={gallery} />
        )}

        {add && (
          <GalleryAddPanel active={!!add} gallery={gallery} />
        )}
      </>
    );
  }

  function setRating(v: number | null) {
    updateGallery({
      variables: {
        input: {
          id: gallery.id,
          rating100: v,
        },
      },
    });
  }

  useRatingKeybinds(
    true,
    configuration?.ui.ratingSystemOptions?.type,
    setRating
  );

  // set up hotkeys
  useEffect(() => {
    Mousetrap.bind("a", () => setActiveTabKey("gallery-details-panel"));
    Mousetrap.bind("c", () => setActiveTabKey("gallery-chapter-panel"));
    Mousetrap.bind("e", () => setActiveTabKey("gallery-edit-panel"));
    Mousetrap.bind("f", () => setActiveTabKey("gallery-file-info-panel"));

    return () => {
      Mousetrap.unbind("a");
      Mousetrap.unbind("c");
      Mousetrap.unbind("e");
      Mousetrap.unbind("f");
    };
  });

  const title = galleryTitle(gallery);

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", mx: -1.75 }}>
      <Helmet>
        <title>{title}</title>
      </Helmet>
      {maybeRenderDeleteDialog()}
      <Box
        className="gallery-tabs"
        sx={{
          flex: { md: "0 0 450px" },
          maxWidth: { md: "450px" },
          maxHeight: { md: "calc(100vh - 4rem)" },
          overflow: "auto",
          overflowWrap: "break-word",
          wordWrap: "break-word",
          order: { xs: 2, md: 1 },
          pl: "15px",
          pr: "15px",
          position: "relative",
          width: "100%",
        }}
      >
        <Box>
          <Box
            className="gallery-header-container"
            sx={{
              display: { lg: "flex" },
              alignItems: { lg: "center" },
              justifyContent: { lg: "space-between" },
            }}
          >
            {gallery.studio && (
              <Box
                className="gallery-studio-image"
                sx={{
                  flex: { lg: "0 0 25%" },
                  order: { lg: 2 },
                  display: "flex",
                  justifyContent: "center",
                  mb: { xs: 2, lg: 0 },
                  "& img": {
                    maxHeight: "100%",
                    maxWidth: "100%",
                    objectFit: "contain"
                  }
                }}
              >
                <Link to={`/studios/${gallery.studio.id}`}>
                  <img
                    src={gallery.studio.image_path ?? ""}
                    alt={`${gallery.studio.name} logo`}
                    className="studio-logo"
                  />
                </Link>
              </Box>
            )}
            <Typography
              variant="h3"
              className={cx("gallery-header", { "no-studio": !gallery.studio })}
              sx={{
                flex: { lg: "0 0 75%" },
                order: { lg: 1 },
                fontSize: { xs: "1.5rem", md: "1.75rem" },
                mt: "30px",
                mb: 0
              }}
            >
              <TruncatedText lineCount={2} text={title} />
            </Typography>
          </Box>

          <Box
            className="gallery-subheader"
            sx={{
              display: "flex",
              justifyContent: "space-between",
              mt: 1,
            }}
          >
            <Box
              component="span"
              className="date"
              sx={{ color: "text.secondary" }}
              data-value={gallery.date}
            >
              {!!gallery.date && <FormattedDate value={gallery.date} />}
            </Box>
          </Box>
        </Box>

        <Box
          className="gallery-toolbar"
          sx={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
            mb: 1,
            mt: 1,
            pb: 1,
            width: "100%",
          }}
        >
          <Box
            component="span"
            className="gallery-toolbar-group"
            sx={{
              alignItems: "center",
              columnGap: 1,
              display: "flex",
              width: "100%",
            }}
          >
            <RatingSystem
              value={gallery.rating100}
              onSetRating={setRating}
              clickToRate
              withoutContext
            />
          </Box>
          <Box
            component="span"
            className="gallery-toolbar-group"
            sx={{
              alignItems: "center",
              columnGap: 1,
              display: "flex",
              width: "100%",
              justifyContent: "flex-end",
            }}
          >
            <Box component="span">
              <OrganizedButton
                loading={organizedLoading}
                organized={gallery.organized}
                onClick={onOrganizedClick}
              />
            </Box>
            <Box component="span">{renderOperations()}</Box>
          </Box>
        </Box>
        {renderTabs()}
      </Box>
      <Box
        className="gallery-container"
        sx={{
          flex: { md: "0 0 calc(100% - 450px)" },
          height: { md: "calc(100vh - 4rem)" },
          maxWidth: { md: "calc(100% - 450px)" },
          overflow: "auto",
          pl: "15px",
          pr: "15px",
          position: "relative",
          width: "100%",
          order: { xs: 1, md: 2 }
        }}
      >
        {renderRightTabs()}
      </Box>
    </Box>
  );
};

const GalleryLoader: React.FC<RouteComponentProps<IGalleryParams>> = ({
  location,
  match,
}) => {
  const { id, tab } = match.params;
  const { data, loading, error } = useFindGallery(id);

  useScrollToTopOnMount();

  if (loading) return <LoadingIndicator />;
  if (error) return <ErrorMessage error={error.message} />;
  if (!data?.findGallery)
    return <ErrorMessage error={`No gallery found with id ${id}.`} />;

  if (tab === "add") {
    return <GalleryPage add gallery={data.findGallery} />;
  }

  if (tab) {
    return (
      <Redirect
        to={{
          ...location,
          pathname: `/galleries/${id}`,
        }}
      />
    );
  }

  return <GalleryPage gallery={data.findGallery} />;
};

export default GalleryLoader;
