import { Tabs, Tab, Box, Menu, MenuItem } from "@mui/material";
import IconButton from "@mui/material/IconButton";
import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useLayoutEffect,
} from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useHistory, Link, RouteComponentProps } from "react-router-dom";
import { Helmet } from "react-helmet";
import * as GQL from "src/core/generated-graphql";
import {
  mutateMetadataScan,
  mutateMetadataGenerate,
  useFindScene,
  useSceneIncrementO,
  useSceneGenerateScreenshot,
  useSceneUpdate,
  queryFindScenes,
  queryFindScenesByID,
  useSceneIncrementPlayCount,
} from "src/core/StashService";

import { SceneEditPanel } from "./SceneEditPanel";
import { ErrorMessage } from "src/components/Shared/ErrorMessage";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { Counter } from "src/components/Shared/Counter";
import { ModalComponent } from "src/components/Shared/Modal";
import { useToast } from "src/hooks/Toast";
import SceneQueue, { QueuedScene } from "src/models/sceneQueue";
import { ListFilterModel } from "src/models/list-filter/filter";
import Mousetrap from "mousetrap";
import { OrganizedButton } from "./OrganizedButton";
import { useConfigurationContext } from "src/hooks/Config";
import { getPlayerPosition } from "src/components/ScenePlayer/util";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { objectPath, objectTitle } from "src/core/files";
import { RatingSystem } from "src/components/Shared/Rating/RatingSystem";
import TextUtils from "src/utils/text";
import {
  OCounterButton,
  ViewCountButton,
} from "src/components/Shared/CountButton";
import { useRatingKeybinds } from "src/hooks/keybinds";
import { lazyComponent } from "src/utils/lazyComponent";
import cx from "classnames";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import { PatchComponent, PatchContainerComponent } from "src/patch";
import { SceneMergeModal } from "../SceneMergeDialog";
import { goBackOrReplace } from "src/utils/history";
import { FormattedDate } from "src/components/Shared/Date";

const SubmitStashBoxDraft = lazyComponent(
  () => import("src/components/Dialogs/SubmitDraft")
);
const ScenePlayer = lazyComponent(
  () => import("src/components/ScenePlayer/ScenePlayer")
);

const GalleryViewer = lazyComponent(
  () => import("src/components/Galleries/GalleryViewer")
);
const ExternalPlayerButton = lazyComponent(
  () => import("./ExternalPlayerButton")
);

const QueueViewer = lazyComponent(() => import("./QueueViewer"));
const SceneMarkersPanel = lazyComponent(() => import("./SceneMarkersPanel"));
const SceneFileInfoPanel = lazyComponent(() => import("./SceneFileInfoPanel"));
const SceneDetailPanel = lazyComponent(() => import("./SceneDetailPanel"));
const SceneHistoryPanel = lazyComponent(() => import("./SceneHistoryPanel"));
const SceneGroupPanel = lazyComponent(() => import("./SceneGroupPanel"));
const SceneGalleriesPanel = lazyComponent(
  () => import("./SceneGalleriesPanel")
);
const DeleteScenesDialog = lazyComponent(() => import("../DeleteScenesDialog"));
const GenerateDialog = lazyComponent(
  () => import("../../Dialogs/GenerateDialog")
);
const SceneVideoFilterPanel = lazyComponent(
  () => import("./SceneVideoFilterPanel")
);
const SceneSegmentsPanel = lazyComponent(
  () => import("./SceneSegmentsPanel").then(module => ({ default: module.SceneSegmentsPanel }))
) as React.FC<{ scene: GQL.SceneDataFragment }>;

const StashFaceIdentification = lazyComponent(
  () => import("src/components/StashFace/StashFaceIdentification").then(module => ({ default: module.StashFaceIdentification }))
) as React.FC<{ scene: GQL.SceneDataFragment }>;

const StashTagIdentification = lazyComponent(
  () => import("src/components/StashTag/StashTagIdentification").then(module => ({ default: module.StashTagIdentification }))
) as React.FC<{ scene: GQL.SceneDataFragment }>;

const SimilarScenesPanel = lazyComponent(
  () => import("../../Recommendations/SimilarItemsPanel").then(module => ({ default: module.SimilarScenesPanel }))
) as React.FC<{ sceneId: string }>;

const VideoFrameRateResolution: React.FC<{
  width?: number;
  height?: number;
  frameRate?: number;
}> = ({ width, height, frameRate }) => {
  const intl = useIntl();

  const resolution = useMemo(() => {
    if (width && height) {
      const r = TextUtils.resolution(width, height);
      return (
        <span className="resolution" data-value={r}>
          {r}
        </span>
      );
    }
    return undefined;
  }, [width, height]);

  const frameRateDisplay = useMemo(() => {
    if (frameRate) {
      return (
        <span className="frame-rate" data-value={frameRate}>
          <FormattedMessage
            id="frames_per_second"
            values={{ value: intl.formatNumber(frameRate ?? 0) }}
          />
        </span>
      );
    }
    return undefined;
  }, [intl, frameRate]);

  const divider = useMemo(() => {
    return resolution && frameRateDisplay ? (
      <span className="divider"> | </span>
    ) : undefined;
  }, [resolution, frameRateDisplay]);

  return (
    <Box component="span" className="scene-video-info">
      {frameRateDisplay}
      {divider}
      {resolution}
    </Box>
  );
};

interface IProps {
  scene: GQL.SceneDataFragment;
  setTimestamp: (num: number) => void;
  queueScenes: QueuedScene[];
  onQueueNext: () => void;
  onQueuePrevious: () => void;
  onQueueRandom: () => void;
  onQueueSceneClicked: (sceneID: string) => void;
  onDelete: () => void;
  continuePlaylist: boolean;
  queueHasMoreScenes: boolean;
  onQueueMoreScenes: () => void;
  onQueueLessScenes: () => void;
  queueStart: number;
  collapsed: boolean;
  setCollapsed: (state: boolean) => void;
  setContinuePlaylist: (value: boolean) => void;
}

interface ISceneParams {
  id: string;
}

const ScenePageTabs = PatchContainerComponent<IProps>("ScenePage.Tabs");
const ScenePageTabContent = PatchContainerComponent<IProps>(
  "ScenePage.TabContent"
);

const ScenePage: React.FC<IProps> = PatchComponent("ScenePage", (props) => {
  const {
    scene,
    setTimestamp,
    queueScenes,
    onQueueNext,
    onQueuePrevious,
    onQueueRandom,
    onQueueSceneClicked,
    onDelete,
    continuePlaylist,
    queueHasMoreScenes,
    onQueueMoreScenes,
    onQueueLessScenes,
    queueStart,
    collapsed,
    setCollapsed,
    setContinuePlaylist,
  } = props;

  const Toast = useToast();
  const intl = useIntl();
  const history = useHistory();
  const [updateScene] = useSceneUpdate();
  const [generateScreenshot] = useSceneGenerateScreenshot();
  const { configuration } = useConfigurationContext();

  const [showDraftModal, setShowDraftModal] = useState(false);
  const boxes = configuration?.general?.stashBoxes ?? [];

  const [incrementO] = useSceneIncrementO(scene.id);

  const [incrementPlay] = useSceneIncrementPlayCount();

  function incrementPlayCount() {
    incrementPlay({
      variables: {
        id: scene.id,
      },
    });
  }

  const [organizedLoading, setOrganizedLoading] = useState(false);

  const [activeTabKey, setActiveTabKey] = useState("scene-details-panel");

  const [isMerging, setIsMerging] = useState(false);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState<boolean>(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isGenerateGalleryDialogOpen, setIsGenerateGalleryDialogOpen] = useState(false);
  const [galleryImageCount, setGalleryImageCount] = useState(20);

  const onIncrementOClick = async () => {
    try {
      await incrementO();
    } catch (e) {
      Toast.error(e);
    }
  };

  function setRating(v: number | null) {
    updateScene({
      variables: {
        input: {
          id: scene.id,
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
    Mousetrap.bind("a", () => setActiveTabKey("scene-details-panel"));
    Mousetrap.bind("q", () => setActiveTabKey("scene-queue-panel"));
    Mousetrap.bind("e", () => setActiveTabKey("scene-edit-panel"));
    Mousetrap.bind("k", () => setActiveTabKey("scene-markers-panel"));
    Mousetrap.bind("s", () => setActiveTabKey("stashface-panel"));
    Mousetrap.bind("t", () => setActiveTabKey("stashtag-panel"));
    Mousetrap.bind("i", () => setActiveTabKey("scene-file-info-panel"));
    Mousetrap.bind("h", () => setActiveTabKey("scene-history-panel"));
    Mousetrap.bind("o", () => {
      onIncrementOClick();
    });
    Mousetrap.bind("p n", () => onQueueNext());
    Mousetrap.bind("p p", () => onQueuePrevious());
    Mousetrap.bind("p r", () => onQueueRandom());
    Mousetrap.bind(",", () => setCollapsed(!collapsed));
    Mousetrap.bind("c c", () => {
      onGenerateScreenshot(getPlayerPosition());
    });
    Mousetrap.bind("c d", () => {
      onGenerateScreenshot();
    });

    return () => {
      Mousetrap.unbind("a");
      Mousetrap.unbind("q");
      Mousetrap.unbind("e");
      Mousetrap.unbind("k");
      Mousetrap.unbind("s");
      Mousetrap.unbind("t");
      Mousetrap.unbind("i");
      Mousetrap.unbind("h");
      Mousetrap.unbind("o");
      Mousetrap.unbind("p n");
      Mousetrap.unbind("p p");
      Mousetrap.unbind("p r");
      Mousetrap.unbind(",");
      Mousetrap.unbind("c c");
      Mousetrap.unbind("c d");
    };
  });

  async function onSave(input: GQL.SceneCreateInput) {
    await updateScene({
      variables: {
        input: {
          id: scene.id,
          ...input,
        },
      },
    });
    Toast.success(
      intl.formatMessage(
        { id: "toast.updated_entity" },
        { entity: intl.formatMessage({ id: "scene" }).toLocaleLowerCase() }
      )
    );
  }

  const onOrganizedClick = async () => {
    try {
      setOrganizedLoading(true);
      await updateScene({
        variables: {
          input: {
            id: scene.id,
            organized: !scene.organized,
          },
        },
      });
    } catch (e) {
      Toast.error(e);
    } finally {
      setOrganizedLoading(false);
    }
  };

  function onClickMarker(marker: GQL.SceneMarkerDataFragment) {
    setTimestamp(marker.seconds);
  }

  async function onRescan() {
    await mutateMetadataScan({
      paths: [objectPath(scene)],
      rescan: true,
    });

    Toast.success(
      intl.formatMessage(
        { id: "toast.rescanning_entity" },
        {
          count: 1,
          singularEntity: intl
            .formatMessage({ id: "scene" })
            .toLocaleLowerCase(),
        }
      )
    );
  }

  async function onGenerateScreenshot(at?: number) {
    await generateScreenshot({
      variables: {
        id: scene.id,
        at,
      },
    });
    Toast.success(intl.formatMessage({ id: "toast.generating_screenshot" }));
  }

  function onDeleteDialogClosed(deleted: boolean) {
    setIsDeleteAlertOpen(false);
    if (deleted) {
      onDelete();
    }
  }

  function maybeRenderMergeDialog() {
    if (!scene.id) return;
    return (
      <SceneMergeModal
        show={isMerging}
        onClose={(mergedId) => {
          setIsMerging(false);
          if (mergedId !== undefined && mergedId !== scene.id) {
            // By default, the merge destination is the current scene, but
            // the user can change it, in which case we need to redirect.
            history.replace(`/scenes/${mergedId}`);
          }
        }}
        scenes={[{ id: scene.id, title: objectTitle(scene) }]}
      />
    );
  }

  function maybeRenderDeleteDialog() {
    if (isDeleteAlertOpen) {
      return (
        <DeleteScenesDialog selected={[scene as unknown as GQL.SlimSceneDataFragment]} onClose={onDeleteDialogClosed} />
      );
    }
  }

  function maybeRenderSceneGenerateDialog() {
    if (isGenerateDialogOpen) {
      return (
        <GenerateDialog
          selectedIds={[scene.id]}
          onClose={() => {
            setIsGenerateDialogOpen(false);
          }}
          type="scene"
        />
      );
    }
  }

  async function onGenerateGalleryConfirm() {
    try {
      await mutateMetadataGenerate({
        sceneIDs: [scene.id],
        galleries: true,
        imageCount: galleryImageCount,
        sprites: false,
        phashes: false,
        previews: false,
        markers: false,
        transcodes: false,
      });
      Toast.success(
        intl.formatMessage(
          { id: "config.tasks.added_job_to_queue" },
          { operation_name: intl.formatMessage({ id: "actions.generate" }) }
        )
      );
    } catch (e) {
      Toast.error(e);
    } finally {
      setIsGenerateGalleryDialogOpen(false);
    }
  }

  function maybeRenderSceneGenerateGalleryDialog() {
    if (isGenerateGalleryDialogOpen) {
      return (
        <ModalComponent
          show
          header={intl.formatMessage({ id: "Generate Gallery" })}
          accept={{
            text: intl.formatMessage({ id: "actions.generate" }),
            onClick: onGenerateGalleryConfirm
          }}
          cancel={{
            text: intl.formatMessage({ id: "Cancel" }),
            onClick: () => setIsGenerateGalleryDialogOpen(false),
            variant: "secondary"
          }}
        >
          <div className="form-group">
            <label><FormattedMessage id="number_of_images" defaultMessage="Number of Images" /></label>
            <input
              type="number"
              className="form-control"
              value={galleryImageCount}
              onChange={(e) => setGalleryImageCount(parseInt(e.target.value) || 0)}
            />
          </div>
        </ModalComponent>
      );
    }
  }

  const [operationsAnchorEl, setOperationsAnchorEl] = React.useState<null | HTMLElement>(null);
  const operationsMenuOpen = Boolean(operationsAnchorEl);
  const operationsMenuRef = React.useRef<HTMLDivElement>(null);

  const handleOperationsClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setOperationsAnchorEl(event.currentTarget);
  };

  const handleOperationsClose = () => {
    setOperationsAnchorEl(null);
  };

  // Manual click-away detection for operations menu
  React.useEffect(() => {
    if (!operationsMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const menuPaper = operationsMenuRef.current;
      const isClickOnMenu = menuPaper && menuPaper.contains(target);
      const isClickOnAnchor = operationsAnchorEl && operationsAnchorEl.contains(target);

      if (!isClickOnMenu && !isClickOnAnchor) {
        handleOperationsClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [operationsMenuOpen, operationsAnchorEl]);

  const renderOperations = () => (
    <>
      <IconButton
        onClick={handleOperationsClick}
        title={intl.formatMessage({ id: "operations" })}
        size="small"
      >
        <MoreVertIcon />
      </IconButton>
      <Menu
        anchorEl={operationsAnchorEl}
        open={operationsMenuOpen}
        onClose={handleOperationsClose}
        disableScrollLock
        hideBackdrop
        slotProps={{
          root: {
            sx: { pointerEvents: 'none' },
            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
          },
          paper: {
            ref: operationsMenuRef,
            sx: { pointerEvents: 'auto' }
          }
        }}
      >
        {!!scene.files.length && (
          <MenuItem
            onClick={() => {
              onRescan();
              handleOperationsClose();
            }}
          >
            <FormattedMessage id="actions.rescan" />
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setIsGenerateDialogOpen(true);
            handleOperationsClose();
          }}
        >
          <FormattedMessage id="actions.generate" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setIsGenerateGalleryDialogOpen(true);
            handleOperationsClose();
          }}
        >
          <FormattedMessage id="actions.create_gallery" defaultMessage="Generate Gallery" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            onGenerateScreenshot(getPlayerPosition());
            handleOperationsClose();
          }}
        >
          <FormattedMessage id="actions.generate_thumb_from_current" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            onGenerateScreenshot();
            handleOperationsClose();
          }}
        >
          <FormattedMessage id="actions.generate_thumb_default" />
        </MenuItem>
        {
          boxes.length > 0 && (
            <MenuItem
              onClick={() => {
                setShowDraftModal(true);
                handleOperationsClose();
              }}
            >
              <FormattedMessage id="actions.submit_stash_box" />
            </MenuItem>
          )
        }
        <MenuItem
          onClick={() => {
            setIsMerging(true);
            handleOperationsClose();
          }}
        >
          <FormattedMessage id="actions.merge" />
          ...
        </MenuItem>
        <MenuItem
          onClick={() => {
            setIsDeleteAlertOpen(true);
            handleOperationsClose();
          }}
        >
          <FormattedMessage
            id="actions.delete"
            values={{ entityType: intl.formatMessage({ id: "scene" }) }}
          />
        </MenuItem>
      </Menu >
    </>
  );

  const renderTabs = () => (
    <Box className="scene-tabs-container">
      <Box className="scene-tabs-header">
        <ScenePageTabs {...props}>
          <Tabs
            value={activeTabKey}
            onChange={(_, newValue: string) => setActiveTabKey(newValue)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            className="scene-tabs-nav"
          >
            <Tab
              value="scene-details-panel"
              label={<FormattedMessage id="details" />}
              className="scene-tab-first"
            />
            {queueScenes.length > 0 && (
              <Tab value="scene-queue-panel" label={<FormattedMessage id="queue" />} />
            )}
            <Tab value="scene-markers-panel" label={<FormattedMessage id="markers" />} />
            {scene.groups.length > 0 && (
              <Tab
                value="scene-group-panel"
                label={<FormattedMessage id="countables.groups" values={{ count: scene.groups.length }} />}
              />
            )}
            {scene.galleries.length >= 1 && (
              <Tab
                value="scene-galleries-panel"
                label={<FormattedMessage id="countables.galleries" values={{ count: scene.galleries.length }} />}
              />
            )}
            {scene.files.length > 0 && (
              <Tab
                value="scene-segments-panel"
                label={<FormattedMessage id="segments" defaultMessage="Segments" />}
              />
            )}
            <Tab value="stashface-panel" label="StashFace" />
            <Tab value="stashtag-panel" label="StashTag" />
            <Tab value="scene-video-filter-panel" label={<FormattedMessage id="effect_filters.name" />} />
            <Tab
              value="scene-file-info-panel"
              label={
                <>
                  <FormattedMessage id="file_info" />
                  <Counter count={scene.files.length} hideZero hideOne />
                </>
              }
            />
            <Tab value="scene-history-panel" label={<FormattedMessage id="history" />} />
            <Tab value="scene-edit-panel" label={<FormattedMessage id="actions.edit" />} />
          </Tabs>
        </ScenePageTabs>
      </Box>

      <ScenePageTabContent {...props}>
        <Box hidden={activeTabKey !== "scene-details-panel"}>
          <SceneDetailPanel scene={scene} />
          <SimilarScenesPanel sceneId={scene.id} />
        </Box>
        <Box hidden={activeTabKey !== "scene-queue-panel"}>
          <QueueViewer
            scenes={queueScenes}
            currentID={scene.id}
            continue={continuePlaylist}
            setContinue={setContinuePlaylist}
            onSceneClicked={onQueueSceneClicked}
            onNext={onQueueNext}
            onPrevious={onQueuePrevious}
            onRandom={onQueueRandom}
            start={queueStart}
            hasMoreScenes={queueHasMoreScenes}
            onLessScenes={onQueueLessScenes}
            onMoreScenes={onQueueMoreScenes}
          />
        </Box>
        <Box hidden={activeTabKey !== "scene-markers-panel"}>
          <SceneMarkersPanel
            sceneId={scene.id}
            onClickMarker={onClickMarker}
            isVisible={activeTabKey === "scene-markers-panel"}
          />
        </Box>
        <Box hidden={activeTabKey !== "scene-group-panel"}>
          <SceneGroupPanel scene={scene} />
        </Box>
        {scene.galleries.length >= 1 && (
          <Box hidden={activeTabKey !== "scene-galleries-panel"}>
            <SceneGalleriesPanel galleries={scene.galleries} />
            {scene.galleries.length === 1 && (
              <GalleryViewer galleryId={scene.galleries[0].id} />
            )}
          </Box>
        )}
        <Box hidden={activeTabKey !== "stashface-panel"}>
          <StashFaceIdentification scene={scene} />
        </Box>
        <Box hidden={activeTabKey !== "stashtag-panel"}>
          <StashTagIdentification scene={scene} />
        </Box>
        <Box hidden={activeTabKey !== "scene-video-filter-panel"}>
          <SceneVideoFilterPanel scene={scene} />
        </Box>
        <Box hidden={activeTabKey !== "scene-segments-panel"}>
          <SceneSegmentsPanel scene={scene} />
        </Box>
        <Box hidden={activeTabKey !== "scene-file-info-panel"} className="file-info-panel">
          <SceneFileInfoPanel scene={scene} />
        </Box>
        <Box hidden={activeTabKey !== "scene-edit-panel"}>
          <SceneEditPanel
            isVisible={activeTabKey === "scene-edit-panel"}
            scene={scene}
            onSubmit={onSave}
            onDelete={() => setIsDeleteAlertOpen(true)}
          />
        </Box>
        <Box hidden={activeTabKey !== "scene-history-panel"}>
          <SceneHistoryPanel scene={scene} />
        </Box>
      </ScenePageTabContent >
    </Box >
  );

  function getCollapseButtonIcon() {
    return collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />;
  }

  const title = objectTitle(scene);

  const file = useMemo(
    () => (scene.files.length > 0 ? scene.files[0] : undefined),
    [scene]
  );

  return (
    <>
      <Helmet>
        <title>{title}</title>
      </Helmet>
      {maybeRenderSceneGenerateDialog()}
      {maybeRenderSceneGenerateGalleryDialog()}
      {maybeRenderMergeDialog()}
      {maybeRenderDeleteDialog()}
      <Box
        className={cx("scene-tabs", { collapsed })}
      >
        <Box>
          <Box className="scene-header-container">
            {scene.studio && (
              <Box className="scene-studio-image">
                <Link to={`/studios/${scene.studio.id}`}>
                  <Box
                    component="img"
                    src={scene.studio.image_path ?? ""}
                    alt={`${scene.studio.name} logo`}
                    className="studio-logo"
                  />
                </Link>
              </Box>
            )}
            <Box className={cx("scene-header", { "no-studio": !scene.studio })}>
              <TruncatedText lineCount={2} text={title} />
            </Box>
          </Box>

          <Box className="scene-subheader">
            <Box component="span" className="date" data-value={scene.date}>
              {!!scene.date && <FormattedDate value={scene.date} />}
            </Box>
            <VideoFrameRateResolution
              width={file?.width}
              height={file?.height}
              frameRate={file?.frame_rate}
            />
          </Box>

          <Box className="scene-toolbar">
            <Box className="scene-toolbar-row">
              <Box className="scene-toolbar-rating">
                <RatingSystem
                  value={scene.rating100}
                  onSetRating={setRating}
                  clickToRate
                  withoutContext
                />
              </Box>
              <Box className="scene-toolbar-counters">
                <ViewCountButton
                  value={scene.play_count ?? 0}
                  onIncrement={() => incrementPlayCount()}
                />
                <OCounterButton
                  value={scene.o_counter ?? 0}
                  onIncrement={() => onIncrementOClick()}
                />
              </Box>
            </Box>
            <Box className="scene-toolbar-row">
              <Box className="scene-toolbar-actions">
                <ExternalPlayerButton scene={scene} />
                <OrganizedButton
                  loading={organizedLoading}
                  organized={scene.organized}
                  onClick={onOrganizedClick}
                />
                {renderOperations()}
              </Box>
            </Box>
          </Box>
        </Box>
        {renderTabs()}
      </Box>
      <SubmitStashBoxDraft
        type="scene"
        boxes={boxes}
        entity={scene}
        show={showDraftModal}
        onHide={() => setShowDraftModal(false)}
      />
    </>
  );
});

const SegmentPlayer = lazyComponent(
  () => import("src/components/ScenePlayer/SegmentPlayer").then(module => ({ default: module.SegmentPlayer }))
) as React.FC<{ scene: GQL.SceneDataFragment }>;

const SceneLoader: React.FC<RouteComponentProps<ISceneParams>> = ({
  location,
  history,
  match,
}) => {
  const { id } = match.params;
  const { configuration } = useConfigurationContext();
  const { data, loading, error } = useFindScene(id);

  const [scene, setScene] = useState<GQL.SceneDataFragment>();

  // useLayoutEffect to update before paint
  useLayoutEffect(() => {
    // only update scene when loading is done
    if (!loading) {
      setScene(data?.findScene ?? undefined);
    }
  }, [data, loading]);

  const queryParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const sceneQueue = useMemo(
    () => SceneQueue.fromQueryParameters(queryParams),
    [queryParams]
  );
  const queryContinue = useMemo(() => {
    let cont = queryParams.get("continue");
    if (cont) {
      return cont === "true";
    } else {
      return !!configuration?.interface.continuePlaylistDefault;
    }
  }, [configuration?.interface.continuePlaylistDefault, queryParams]);

  const [queueScenes, setQueueScenes] = useState<QueuedScene[]>([]);

  const [collapsed, setCollapsed] = useState(false);
  const [continuePlaylist, setContinuePlaylist] = useState(queryContinue);
  const [hideScrubber, setHideScrubber] = useState(
    !(configuration?.interface.showScrubber ?? true)
  );

  const _setTimestamp = useRef<(value: number) => void>();
  const initialTimestamp = useMemo(() => {
    const t = queryParams.get("t");
    if (!t) return 0;

    const n = Number(t);
    if (Number.isNaN(n)) return 0;
    return n;
  }, [queryParams]);

  const [queueTotal, setQueueTotal] = useState(0);
  const [queueStart, setQueueStart] = useState(1);

  const autoplay = queryParams.get("autoplay") === "true";
  const autoPlayOnSelected =
    configuration?.interface.autostartVideoOnPlaySelected ?? false;

  const currentQueueIndex = useMemo(
    () => queueScenes.findIndex((s) => s.id === id),
    [queueScenes, id]
  );

  function getSetTimestamp(fn: (value: number) => void) {
    _setTimestamp.current = fn;
  }

  function setTimestamp(value: number) {
    if (_setTimestamp.current) {
      _setTimestamp.current(value);
    }
  }

  // set up hotkeys
  useEffect(() => {
    Mousetrap.bind(".", () => setHideScrubber((value) => !value));

    return () => {
      Mousetrap.unbind(".");
    };
  }, []);

  async function getQueueFilterScenes(filter: ListFilterModel) {
    const query = await queryFindScenes(filter);
    const { scenes, count } = query.data.findScenes;
    setQueueScenes(scenes);
    setQueueTotal(count);
    setQueueStart((filter.currentPage - 1) * filter.itemsPerPage + 1);
  }

  async function getQueueScenes(sceneIDs: number[]) {
    const query = await queryFindScenesByID(sceneIDs);
    const { scenes, count } = query.data.findScenes;
    setQueueScenes(scenes);
    setQueueTotal(count);
    setQueueStart(1);
  }

  useEffect(() => {
    if (sceneQueue.query) {
      getQueueFilterScenes(sceneQueue.query);
    } else if (sceneQueue.sceneIDs) {
      getQueueScenes(sceneQueue.sceneIDs);
    }
  }, [sceneQueue]);

  async function onQueueLessScenes() {
    if (!sceneQueue.query || queueStart <= 1) {
      return;
    }

    const filterCopy = sceneQueue.query.clone();
    const newStart = queueStart - filterCopy.itemsPerPage;
    filterCopy.currentPage = Math.ceil(newStart / filterCopy.itemsPerPage);
    const query = await queryFindScenes(filterCopy);
    const { scenes } = query.data.findScenes;

    // prepend scenes to scene list
    const newScenes = (scenes as QueuedScene[]).concat(queueScenes);
    setQueueScenes(newScenes);
    setQueueStart(newStart);

    return scenes;
  }

  const queueHasMoreScenes = useMemo(() => {
    return queueStart + queueScenes.length - 1 < queueTotal;
  }, [queueStart, queueScenes, queueTotal]);

  async function onQueueMoreScenes() {
    if (!sceneQueue.query || !queueHasMoreScenes) {
      return;
    }

    const filterCopy = sceneQueue.query.clone();
    const newStart = queueStart + queueScenes.length;
    filterCopy.currentPage = Math.ceil(newStart / filterCopy.itemsPerPage);
    const query = await queryFindScenes(filterCopy);
    const { scenes } = query.data.findScenes;

    // append scenes to scene list
    const newScenes = queueScenes.concat(scenes);
    setQueueScenes(newScenes);
    // don't change queue start
    return scenes;
  }

  function loadScene(sceneID: string, autoPlay?: boolean, newPage?: number) {
    const sceneLink = sceneQueue.makeLink(sceneID, {
      newPage,
      autoPlay,
      continue: continuePlaylist,
    });
    history.replace(sceneLink);
  }

  async function queueNext(autoPlay: boolean) {
    if (currentQueueIndex === -1) return;

    if (currentQueueIndex < queueScenes.length - 1) {
      loadScene(queueScenes[currentQueueIndex + 1].id, autoPlay);
    } else {
      // if we're at the end of the queue, load more scenes
      if (currentQueueIndex === queueScenes.length - 1 && queueHasMoreScenes) {
        const loadedScenes = await onQueueMoreScenes();
        if (loadedScenes && loadedScenes.length > 0) {
          // set the page to the next page
          const newPage = (sceneQueue.query?.currentPage ?? 0) + 1;
          loadScene(loadedScenes[0].id, autoPlay, newPage);
        }
      }
    }
  }

  async function queuePrevious(autoPlay: boolean) {
    if (currentQueueIndex === -1) return;

    if (currentQueueIndex > 0) {
      loadScene(queueScenes[currentQueueIndex - 1].id, autoPlay);
    } else {
      // if we're at the beginning of the queue, load the previous page
      if (queueStart > 1) {
        const loadedScenes = await onQueueLessScenes();
        if (loadedScenes && loadedScenes.length > 0) {
          const newPage = (sceneQueue.query?.currentPage ?? 0) - 1;
          loadScene(
            loadedScenes[loadedScenes.length - 1].id,
            autoPlay,
            newPage
          );
        }
      }
    }
  }

  async function queueRandom(autoPlay: boolean) {
    if (sceneQueue.query) {
      const { query } = sceneQueue;
      const pages = Math.ceil(queueTotal / query.itemsPerPage);
      const page = Math.floor(Math.random() * pages) + 1;
      const index = Math.floor(
        Math.random() * Math.min(query.itemsPerPage, queueTotal)
      );
      const filterCopy = sceneQueue.query.clone();
      filterCopy.currentPage = page;
      const queryResults = await queryFindScenes(filterCopy);
      if (queryResults.data.findScenes.scenes.length > index) {
        const { id: sceneID } = queryResults.data.findScenes.scenes[index];
        // navigate to the image player page
        loadScene(sceneID, autoPlay, page);
      }
    } else if (queueTotal !== 0) {
      const index = Math.floor(Math.random() * queueTotal);
      loadScene(queueScenes[index].id, autoPlay);
    }
  }

  function onComplete() {
    // load the next scene if we're continuing
    if (continuePlaylist) {
      queueNext(true);
    }
  }

  function onDelete() {
    if (
      continuePlaylist &&
      currentQueueIndex >= 0 &&
      currentQueueIndex < queueScenes.length - 1
    ) {
      loadScene(queueScenes[currentQueueIndex + 1].id);
    } else {
      goBackOrReplace(history, "/scenes");
    }
  }

  function getScenePage(sceneID: string) {
    if (!sceneQueue.query) return;

    // find the page that the scene is on
    const index = queueScenes.findIndex((s) => s.id === sceneID);

    if (index === -1) return;

    const perPage = sceneQueue.query.itemsPerPage;
    return Math.floor((index + queueStart - 1) / perPage) + 1;
  }

  function onQueueSceneClicked(sceneID: string) {
    loadScene(sceneID, autoPlayOnSelected, getScenePage(sceneID));
  }

  if (!scene) {
    if (loading) return <LoadingIndicator />;
    if (error) return <ErrorMessage error={error.message} />;
    return <ErrorMessage error={`No scene found with id ${id}.`} />;
  }

  const isSegment = (scene?.start_point !== null && scene?.start_point !== undefined && scene.start_point > 0) || (scene?.end_point !== null && scene?.end_point !== undefined && scene.end_point > 0);

  return (
    <Box className="scene-layout">
      <Box className={cx("scene-detail-panel", { collapsed })}>
        <ScenePage
          scene={scene}
          setTimestamp={setTimestamp}
          queueScenes={queueScenes}
          queueStart={queueStart}
          onDelete={onDelete}
          onQueueNext={() => queueNext(autoPlayOnSelected)}
          onQueuePrevious={() => queuePrevious(autoPlayOnSelected)}
          onQueueRandom={() => queueRandom(autoPlayOnSelected)}
          onQueueSceneClicked={onQueueSceneClicked}
          continuePlaylist={continuePlaylist}
          queueHasMoreScenes={queueHasMoreScenes}
          onQueueLessScenes={onQueueLessScenes}
          onQueueMoreScenes={onQueueMoreScenes}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          setContinuePlaylist={setContinuePlaylist}
        />
      </Box>

      {/* Modern Persistent Toggle Divider */}
      <Box
        className="scene-toggle-divider"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
      </Box>

      <Box className={cx("scene-player-container", { expanded: collapsed })}>
        {isSegment ? (
          <SegmentPlayer scene={scene} />
        ) : (
          <ScenePlayer
            key="ScenePlayer"
            scene={scene}
            hideScrubberOverride={hideScrubber}
            autoplay={autoplay}
            permitLoop={!continuePlaylist}
            initialTimestamp={initialTimestamp}
            sendSetTimestamp={getSetTimestamp}
            onComplete={onComplete}
            onNext={() => queueNext(true)}
            onPrevious={() => queuePrevious(true)}
          />
        )}
      </Box>
    </Box>
  );
};

export default SceneLoader;
