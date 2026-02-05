import { Tabs, Tab, Box, Menu, MenuItem, IconButton, Typography } from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useHistory, Link, RouteComponentProps } from "react-router-dom";
import { Helmet } from "react-helmet";
import {
  useFindImage,
  useImageIncrementO,
  useImageUpdate,
  mutateMetadataScan,
  useImageDecrementO,
  useImageResetO,
} from "src/core/StashService";
import { ErrorMessage } from "src/components/Shared/ErrorMessage";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { Counter } from "src/components/Shared/Counter";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useToast } from "src/hooks/Toast";
import * as Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import { OCounterButton } from "src/components/Scenes/SceneDetails/OCounterButton";
import { OrganizedButton } from "src/components/Scenes/SceneDetails/OrganizedButton";
import { ImageFileInfoPanel } from "./ImageFileInfoPanel";
import { ImageEditPanel } from "./ImageEditPanel";
import { ImageDetailPanel } from "./ImageDetailPanel";
import { DeleteImagesDialog } from "../DeleteImagesDialog";
import { imagePath, imageTitle } from "src/core/files";
import { isVideo } from "src/utils/visualFile";
import { useScrollToTopOnMount } from "src/hooks/scrollToTop";
import { useRatingKeybinds } from "src/hooks/keybinds";
import { useConfigurationContext } from "src/hooks/Config";
import TextUtils from "src/utils/text";
import { RatingSystem } from "src/components/Shared/Rating/RatingSystem";
import cx from "classnames";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import { goBackOrReplace } from "src/utils/history";
import { FormattedDate } from "src/components/Shared/Date";
import { GenerateDialog } from "src/components/Dialogs/GenerateDialog";

interface IProps {
  image: GQL.ImageDataFragment;
}

interface IImageParams {
  id: string;
}

const ImagePage: React.FC<IProps> = ({ image }) => {
  const history = useHistory();
  const Toast = useToast();
  const intl = useIntl();
  const { configuration } = useConfigurationContext();

  const [incrementO] = useImageIncrementO(image.id);
  const [decrementO] = useImageDecrementO(image.id);
  const [resetO] = useImageResetO(image.id);

  const [updateImage] = useImageUpdate();

  const [organizedLoading, setOrganizedLoading] = useState(false);

  const [activeTabKey, setActiveTabKey] = useState(0);

  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState<boolean>(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);

  async function onSave(input: GQL.ImageUpdateInput) {
    await updateImage({
      variables: { input },
    });
    Toast.success(
      intl.formatMessage(
        { id: "toast.updated_entity" },
        { entity: intl.formatMessage({ id: "image" }).toLocaleLowerCase() }
      )
    );
  }

  async function onRescan() {
    if (!image || !image.visual_files.length) {
      return;
    }

    await mutateMetadataScan({
      paths: [imagePath(image)],
      rescan: true,
    });

    Toast.success(
      intl.formatMessage(
        { id: "toast.rescanning_entity" },
        {
          count: 1,
          singularEntity: intl.formatMessage({ id: "image" }),
        }
      )
    );
  }

  const onOrganizedClick = async () => {
    try {
      setOrganizedLoading(true);
      await updateImage({
        variables: {
          input: {
            id: image.id,
            organized: !image.organized,
          },
        },
      });
    } catch (e) {
      Toast.error(e);
    } finally {
      setOrganizedLoading(false);
    }
  };

  const onIncrementClick = async () => {
    try {
      await incrementO();
    } catch (e) {
      Toast.error(e);
    }
  };

  const onDecrementClick = async () => {
    try {
      await decrementO();
    } catch (e) {
      Toast.error(e);
    }
  };

  const onResetClick = async () => {
    try {
      await resetO();
    } catch (e) {
      Toast.error(e);
    }
  };

  function setRating(v: number | null) {
    updateImage({
      variables: {
        input: {
          id: image.id,
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

  function onDeleteDialogClosed(deleted: boolean) {
    setIsDeleteAlertOpen(false);
    if (deleted) {
      goBackOrReplace(history, "/images");
    }
  }

  function maybeRenderDeleteDialog() {
    if (isDeleteAlertOpen && image) {
      return (
        <DeleteImagesDialog selected={[image]} onClose={onDeleteDialogClosed} />
      );
    }
  }

  function maybeRenderGenerateDialog() {
    if (isGenerateDialogOpen) {
      return (
        <GenerateDialog
          selectedIds={[image.id]}
          onClose={() => {
            setIsGenerateDialogOpen(false);
          }}
          type="image"
        />
      );
    }
  }

  function renderOperations() {
    return (
      <>
        <IconButton
          onClick={(e) => setAnchorEl(e.currentTarget)}
          title="Operations"
          size="small"
        >
          <MoreVertIcon />
        </IconButton>
        <Menu
          anchorEl={anchorEl}
          open={menuOpen}
          onClose={() => setAnchorEl(null)}
          disableScrollLock
        >
          <MenuItem
            onClick={() => {
              onRescan();
              setAnchorEl(null);
            }}
          >
            <FormattedMessage id="actions.rescan" />
          </MenuItem>
          <MenuItem
            onClick={() => {
              setIsGenerateDialogOpen(true);
              setAnchorEl(null);
            }}
          >
            <FormattedMessage id="actions.generate" />…
          </MenuItem>
          <MenuItem
            onClick={() => {
              setIsDeleteAlertOpen(true);
              setAnchorEl(null);
            }}
          >
            <FormattedMessage
              id="actions.delete"
              values={{ entityType: intl.formatMessage({ id: "image" }) }}
            />
          </MenuItem>
        </Menu>
      </>
    );
  }

  function renderTabs() {
    if (!image) {
      return;
    }

    return (
      <Box>
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
            onChange={(_e, newValue) => setActiveTabKey(newValue)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            <Tab label={<FormattedMessage id="details" />} />
            <Tab
              label={
                <>
                  <FormattedMessage id="file_info" />
                  <Counter count={image.visual_files.length} hideZero hideOne />
                </>
              }
            />
            <Tab label={<FormattedMessage id="actions.edit" />} />
          </Tabs>
        </Box>

        <Box>
          {activeTabKey === 0 && <ImageDetailPanel image={image} />}
          {activeTabKey === 1 && (
            <Box className="file-info-panel">
              <ImageFileInfoPanel image={image} />
            </Box>
          )}
          {activeTabKey === 2 && (
            <ImageEditPanel
              isVisible={activeTabKey === 2}
              image={image}
              onSubmit={onSave}
              onDelete={() => setIsDeleteAlertOpen(true)}
            />
          )}
        </Box>
      </Box>
    );
  }

  // set up hotkeys
  useEffect(() => {
    Mousetrap.bind("a", () => setActiveTabKey(0));
    Mousetrap.bind("e", () => setActiveTabKey(2));
    Mousetrap.bind("f", () => setActiveTabKey(1));
    Mousetrap.bind("o", () => {
      onIncrementClick();
    });

    return () => {
      Mousetrap.unbind("a");
      Mousetrap.unbind("e");
      Mousetrap.unbind("f");
      Mousetrap.unbind("o");
    };
  });

  const file = useMemo(
    () => (image.visual_files.length > 0 ? image.visual_files[0] : undefined),
    [image]
  );

  const title = imageTitle(image);
  const ImageView =
    image.visual_files.length > 0 && isVideo(image.visual_files[0])
      ? "video"
      : "img";

  const resolution = useMemo(() => {
    return file?.width && file?.height
      ? TextUtils.resolution(file?.width, file?.height)
      : undefined;
  }, [file?.width, file?.height]);

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", mx: -1.75 }}>
      <Helmet>
        <title>{title}</title>
      </Helmet>

      {maybeRenderDeleteDialog()}
      {maybeRenderGenerateDialog()}
      <Box
        className="image-tabs"
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
            className="image-header-container"
            sx={{
              display: { lg: "flex" },
              alignItems: { lg: "center" },
              justifyContent: { lg: "space-between" },
            }}
          >
            {image.studio && (
              <Box
                className="image-studio-image"
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
                <Link to={`/studios/${image.studio.id}`}>
                  <img
                    src={image.studio.image_path ?? ""}
                    alt={`${image.studio.name} logo`}
                    className="studio-logo"
                  />
                </Link>
              </Box>
            )}
            <Typography
              variant="h3"
              className={cx("image-header", { "no-studio": !image.studio })}
              sx={{
                flex: { lg: "0 0 75%" },
                order: { lg: 1 },
                fontSize: { xs: "1.5rem", xl: "1.75rem" },
                mt: "30px",
                mb: 0
              }}
            >
              <TruncatedText lineCount={2} text={title} />
            </Typography>
          </Box>

          <Box
            className="image-subheader"
            sx={{
              display: "flex",
              justifyContent: "space-between",
              mt: 1
            }}
          >
            <Box
              component="span"
              className="date"
              sx={{ color: "text.secondary" }}
              data-value={image.date}
            >
              {!!image.date && <FormattedDate value={image.date} />}
            </Box>
            {resolution ? (
              <Typography
                variant="body2"
                className="resolution"
                sx={{ fontWeight: "bold" }}
                data-value={resolution}
              >
                {resolution}
              </Typography>
            ) : undefined}
          </Box>
        </Box>

        <Box
          className="image-toolbar"
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
            className="image-toolbar-group"
            sx={{
              alignItems: "center",
              columnGap: 1,
              display: "flex",
              width: "100%",
            }}
          >
            <RatingSystem
              value={image.rating100}
              onSetRating={setRating}
              clickToRate
              withoutContext
            />
          </Box>
          <Box
            component="span"
            className="image-toolbar-group"
            sx={{
              alignItems: "center",
              columnGap: 1,
              display: "flex",
              width: "100%",
              justifyContent: "flex-end",
            }}
          >
            <Box component="span">
              <OCounterButton
                value={image.o_counter || 0}
                onIncrement={onIncrementClick}
                onDecrement={onDecrementClick}
                onReset={onResetClick}
              />
            </Box>
            <Box component="span">
              <OrganizedButton
                loading={organizedLoading}
                organized={image.organized}
                onClick={onOrganizedClick}
              />
            </Box>
            <Box component="span">{renderOperations()}</Box>
          </Box>
        </Box>
        {renderTabs()}
      </Box>
      <Box
        className="image-container"
        sx={{
          display: "flex",
          flex: { md: "0 0 calc(100% - 450px)" },
          height: { md: "calc(100vh - 4rem)" },
          maxWidth: { md: "calc(100% - 450px)" },
          pl: "15px",
          pr: "15px",
          position: "relative",
          width: "100%",
          order: { xs: 1, md: 2 }
        }}
      >
        {image.visual_files.length > 0 && (
          <Box
            component={ImageView}
            {...(image.visual_files[0].__typename == "VideoFile" ? { loop: true, autoPlay: true, playsInline: true, controls: true } : {})}
            className="m-sm-auto no-gutter image-image"
            alt={title}
            src={image.paths.image ?? ""}
            sx={{
              maxHeight: "calc(100vh - 4rem)",
              maxWidth: "100%",
              objectFit: "contain",
              ...(image.visual_files[0].__typename == "VideoFile" ? { width: "100%", height: "100%" } : {})
            }}
          />
        )}
      </Box>
    </Box>
  );
};

const ImageLoader: React.FC<RouteComponentProps<IImageParams>> = ({
  match,
}) => {
  const { id } = match.params;
  const { data, loading, error } = useFindImage(id);

  useScrollToTopOnMount();

  if (loading) return <LoadingIndicator />;
  if (error) return <ErrorMessage error={error.message} />;
  if (!data?.findImage)
    return <ErrorMessage error={`No image found with id ${id}.`} />;

  return <ImagePage image={data.findImage} />;
};

export default ImageLoader;
