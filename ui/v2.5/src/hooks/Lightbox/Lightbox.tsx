import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  Popover,
  Grid,
  Box,
  Menu,
  IconButton,
} from "@mui/material";
import cx from "classnames";
import Mousetrap from "mousetrap";

import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import useInterval from "../Interval";
import usePageVisibility from "../PageVisibility";
import { useToast } from "../Toast";
import { FormattedMessage, useIntl } from "react-intl";
import { LightboxImage } from "./LightboxImage";
import { LightboxControls } from "./LightboxControls";
import { useConfigurationContext } from "../Config";
import { Link } from "react-router-dom";
import { OCounterButton } from "src/components/Scenes/SceneDetails/OCounterButton";
import {
  mutateImageIncrementO,
  mutateImageDecrementO,
  mutateImageResetO,
  useImageUpdate,
} from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import { useInterfaceLocalForage } from "../LocalForage";
import { imageLightboxDisplayModeIntlMap } from "src/core/enums";
import { ILightboxImage, IChapter } from "./types";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import SettingsIcon from "@mui/icons-material/Settings";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import CloseIcon from "@mui/icons-material/Close";
import MenuIcon from "@mui/icons-material/Menu";
import CollectionsIcon from "@mui/icons-material/Collections";
import { RatingSystem } from "src/components/Shared/Rating/RatingSystem";
import { useDebounce } from "../debounce";
import { isVideo } from "src/utils/visualFile";
import { imageTitle } from "src/core/files";
import { galleryTitle } from "src/core/galleries";

const DEFAULT_SLIDESHOW_DELAY = 5000;
const SECONDS_TO_MS = 1000;
const MIN_VALID_INTERVAL_SECONDS = 1;
const MIN_ZOOM = 0.1;
const SCROLL_ZOOM_TIMEOUT = 250;
const ZOOM_NONE_EPSILON = 0.015;

interface ILightboxFilmstripProps {
  visible: boolean;
  images: ILightboxImage[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

const LightboxFilmstrip: React.FC<ILightboxFilmstripProps> = ({
  visible,
  images,
  currentIndex,
  onSelect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to selected item
  useEffect(() => {
    if (visible && selectedRef.current && containerRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [currentIndex, visible]);

  if (!visible) return null;

  return (
    <div
      className={cx(
        "fixed bottom-24 left-1/2 -translate-x-1/2 z-[1050] w-full max-w-5xl px-4 transition-all duration-300",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
      )}
    >
      <div
        ref={containerRef}
        className="flex gap-2 overflow-x-auto p-2 bg-black/60 backdrop-blur-md rounded-xl border border-white/5 shadow-2xl scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
        style={{ scrollBehavior: "smooth" }}
      >
        {images.map((image, index) => {
          const isSelected = index === currentIndex;
          const source =
            image.paths.preview != ""
              ? image.paths.preview ?? ""
              : image.paths.thumbnail ?? "";
          const isVideo = image.paths.preview != "";

          return (
            <button
              key={image.id || index}
              ref={isSelected ? selectedRef : null}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(index);
              }}
              className={cx(
                "relative flex-shrink-0 h-16 aspect-[2/3] rounded-md overflow-hidden transition-all duration-200 focus:outline-none ring-2",
                isSelected
                  ? "ring-primary scale-105 z-10 opacity-100"
                  : "ring-transparent opacity-60 hover:opacity-100 hover:scale-105"
              )}
            >
              {isVideo ? (
                <video
                  src={source}
                  className="w-full h-full object-cover"
                  autoPlay={false}
                  muted
                  loop
                  playsInline
                />
              ) : (
                <img
                  src={source}
                  alt={image.title || ""}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface IProps {
  images: ILightboxImage[];
  isVisible: boolean;
  isLoading: boolean;
  initialIndex?: number;
  showNavigation: boolean;
  showFilmstrip?: boolean;
  slideshowEnabled?: boolean;
  page?: number;
  pages?: number;
  pageSize?: number;
  pageCallback?: (props: { direction?: number; page?: number }) => void;
  chapters?: IChapter[];
  hide: () => void;
}

export const LightboxComponent: React.FC<IProps> = ({
  images,
  isVisible,
  isLoading,
  initialIndex = 0,
  showNavigation,
  showFilmstrip = false,
  slideshowEnabled = false,
  page,
  pages,
  pageSize: pageSize = 40,
  pageCallback,
  chapters = [],
  hide,
}) => {
  const [updateImage] = useImageUpdate();

  // zero-based
  const [index, setIndex] = useState<number | null>(null);
  const [movingLeft, setMovingLeft] = useState(false);
  const oldIndex = useRef<number | null>(null);
  const [instantTransition, setInstantTransition] = useState(false);
  const [isSwitchingPage, setIsSwitchingPage] = useState(true);
  const [isFullscreen, setFullscreen] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(0);
  const [navOffset, setNavOffset] = useState<React.CSSProperties | undefined>();

  const oldImages = useRef<ILightboxImage[]>([]);

  const [zoom, setZoom] = useState(1);

  function updateZoom(v: number) {
    if (v < MIN_ZOOM) {
      setZoom(MIN_ZOOM);
    } else if (Math.abs(v - 1) < ZOOM_NONE_EPSILON) {
      // "snap to 1" effect: if new zoom is close to 1, set to 1
      setZoom(1);
    } else {
      setZoom(v);
    }
  }

  const [resetPosition, setResetPosition] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayTarget = useRef<HTMLButtonElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const clearIntervalCallback = useRef<() => void>();
  const resetIntervalCallback = useRef<() => void>();

  const allowNavigation = images.length > 1 || pageCallback;

  const Toast = useToast();
  const intl = useIntl();
  const { configuration: config } = useConfigurationContext();
  const [interfaceLocalForage, setInterfaceLocalForage] =
    useInterfaceLocalForage();

  const lightboxSettings = interfaceLocalForage.data?.imageLightbox;

  function setLightboxSettings(v: Partial<GQL.ConfigImageLightboxInput>) {
    setInterfaceLocalForage((prev) => {
      return {
        ...prev,
        imageLightbox: {
          ...prev.imageLightbox,
          ...v,
        },
      };
    });
  }

  function setScaleUp(value: boolean) {
    setLightboxSettings({ scaleUp: value });
  }

  function setResetZoomOnNav(v: boolean) {
    setLightboxSettings({ resetZoomOnNav: v });
  }

  function setScrollMode(v: GQL.ImageLightboxScrollMode) {
    setLightboxSettings({ scrollMode: v });
  }

  const configuredDelay = config?.interface.imageLightbox.slideshowDelay
    ? config.interface.imageLightbox.slideshowDelay * SECONDS_TO_MS
    : undefined;

  const savedDelay = lightboxSettings?.slideshowDelay
    ? lightboxSettings.slideshowDelay * SECONDS_TO_MS
    : undefined;

  const slideshowDelay =
    savedDelay ?? configuredDelay ?? DEFAULT_SLIDESHOW_DELAY;

  const scrollAttemptsBeforeChange = Math.max(
    0,
    config?.interface.imageLightbox.scrollAttemptsBeforeChange ?? 0
  );

  const disableAnimation = config?.interface.imageLightbox.disableAnimation;

  function setSlideshowDelay(v: number) {
    setLightboxSettings({ slideshowDelay: v });
  }

  const displayMode =
    lightboxSettings?.displayMode ?? GQL.ImageLightboxDisplayMode.FitXy;
  const oldDisplayMode = useRef(displayMode);

  function setDisplayMode(v: GQL.ImageLightboxDisplayMode) {
    setLightboxSettings({ displayMode: v });
  }

  // slideshowInterval is used for controlling the logic
  // displaySlideshowInterval is for display purposes only
  // keeping them separate and independant allows us to handle the logic however we want
  // while still displaying something that makes sense to the user
  const [slideshowInterval, setSlideshowInterval] = useState<number | null>(
    null
  );

  const [displayedSlideshowInterval, setDisplayedSlideshowInterval] =
    useState<string>((slideshowDelay / SECONDS_TO_MS).toString());

  useEffect(() => {
    if (images !== oldImages.current && isSwitchingPage) {
      if (index === -1) setIndex(images.length - 1);
      setIsSwitchingPage(false);
    }
  }, [isSwitchingPage, images, index]);

  const disableInstantTransition = useDebounce(
    () => setInstantTransition(false),
    400
  );

  const setInstant = useCallback(() => {
    setInstantTransition(true);
    disableInstantTransition();
  }, [disableInstantTransition]);

  useEffect(() => {
    if (images.length < 2) return;
    if (index === oldIndex.current) return;
    if (index === null) return;

    // reset zoom status
    // setResetZoom((r) => !r);
    // setZoomed(false);
    if (lightboxSettings?.resetZoomOnNav) {
      setZoom(1);
    }
    setResetPosition((r) => !r);

    oldIndex.current = index;
  }, [index, images.length, lightboxSettings?.resetZoomOnNav]);

  const getNavOffset = useCallback(() => {
    if (images.length < 2) return;
    if (index === undefined || index === null) return;

    if (navRef.current) {
      const currentThumb = navRef.current.children[index + 1];
      if (currentThumb instanceof HTMLImageElement) {
        const offset =
          -1 *
          (currentThumb.offsetLeft - document.documentElement.clientWidth / 2);

        return { left: `${offset}px` };
      }
    }
  }, [index, images.length]);

  useEffect(() => {
    // reset images loaded counter for new images
    setImagesLoaded(0);
  }, [images]);

  useEffect(() => {
    setNavOffset(getNavOffset() ?? undefined);
  }, [getNavOffset]);

  useEffect(() => {
    if (displayMode !== oldDisplayMode.current) {
      // reset zoom status
      // setResetZoom((r) => !r);
      // setZoomed(false);
      if (lightboxSettings?.resetZoomOnNav) {
        setZoom(1);
      }
      setResetPosition((r) => !r);
    }
    oldDisplayMode.current = displayMode;
  }, [displayMode, lightboxSettings?.resetZoomOnNav]);

  const selectIndex = (e: React.MouseEvent, i: number) => {
    setIndex(i);
    e.stopPropagation();
  };

  useEffect(() => {
    if (isVisible) {
      if (index === null) setIndex(initialIndex);
      document.body.style.overflow = "hidden";
      Mousetrap.pause();
    }
  }, [initialIndex, isVisible, setIndex, index]);

  const toggleSlideshow = useCallback(() => {
    if (slideshowInterval) {
      setSlideshowInterval(null);
    } else {
      setSlideshowInterval(slideshowDelay);
    }
  }, [slideshowInterval, slideshowDelay]);

  // stop slideshow when the page is hidden
  usePageVisibility((hidden: boolean) => {
    if (hidden) {
      setSlideshowInterval(null);
    }
  });

  const close = useCallback(() => {
    if (isFullscreen) document.exitFullscreen();

    hide();
    document.body.style.overflow = "auto";
    Mousetrap.unpause();
  }, [isFullscreen, hide]);

  const handleClose = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.dataset.closeLightbox) close();
  };

  const handleLeft = useCallback(
    (isUserAction = true) => {
      if (isSwitchingPage || index === -1) return;

      if (disableAnimation) {
        setInstant();
      }

      setShowChapters(false);
      setMovingLeft(true);

      if (index === 0) {
        // go to next page, or loop back if no callback is set
        if (pageCallback) {
          pageCallback({ direction: -1 });
          setIndex(-1);
          oldImages.current = images;
          setIsSwitchingPage(true);
        } else setIndex(images.length - 1);
      } else setIndex((index ?? 0) - 1);

      if (isUserAction && resetIntervalCallback.current) {
        resetIntervalCallback.current();
      }
    },
    [
      images,
      pageCallback,
      isSwitchingPage,
      resetIntervalCallback,
      index,
      disableAnimation,
      setInstant,
    ]
  );

  const handleRight = useCallback(
    (isUserAction = true) => {
      if (isSwitchingPage) return;

      if (disableAnimation) {
        setInstant();
      }

      setMovingLeft(false);
      setShowChapters(false);

      if (index === images.length - 1) {
        // go to preview page, or loop back if no callback is set
        if (pageCallback) {
          pageCallback({ direction: 1 });
          oldImages.current = images;
          setIsSwitchingPage(true);
          setIndex(0);
        } else setIndex(0);
      } else setIndex((index ?? 0) + 1);

      if (isUserAction && resetIntervalCallback.current) {
        resetIntervalCallback.current();
      }
    },
    [
      images,
      setIndex,
      pageCallback,
      isSwitchingPage,
      resetIntervalCallback,
      index,
      disableAnimation,
      setInstant,
    ]
  );

  const firstScroll = useRef<number | null>(null);
  const inScrollGroup = useRef(false);

  const debouncedScrollReset = useDebounce(() => {
    firstScroll.current = null;
    inScrollGroup.current = false;
  }, SCROLL_ZOOM_TIMEOUT);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.repeat && (e.key === "ArrowRight" || e.key === "ArrowLeft"))
        setInstant();
      if (e.key === "ArrowLeft") handleLeft();
      else if (e.key === "ArrowRight") handleRight();
      else if (e.key === "Escape") close();
    },
    [setInstant, handleLeft, handleRight, close]
  );
  const handleFullScreenChange = () => {
    if (clearIntervalCallback.current) {
      clearIntervalCallback.current();
    }
    setFullscreen(document.fullscreenElement !== null);
  };

  const [clearCallback, resetCallback] = useInterval(
    () => {
      handleRight(false);
    },
    slideshowEnabled ? slideshowInterval : null
  );

  resetIntervalCallback.current = resetCallback;
  clearIntervalCallback.current = clearCallback;

  useEffect(() => {
    if (isVisible) {
      document.addEventListener("keydown", handleKey);
      document.addEventListener("fullscreenchange", handleFullScreenChange);
    }
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("fullscreenchange", handleFullScreenChange);
    };
  }, [isVisible, handleKey]);

  const toggleFullscreen = useCallback(() => {
    if (!isFullscreen) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  }, [isFullscreen]);

  function imageLoaded() {
    setImagesLoaded((loaded) => loaded + 1);

    if (imagesLoaded === images.length - 1) {
      // all images are loaded - update the nav offset
      setNavOffset(getNavOffset() ?? undefined);
    }
  }

  const navItems = images.map((image, i) =>
    React.createElement(image.paths.preview != "" ? "video" : "img", {
      loop: image.paths.preview != "",
      autoPlay: image.paths.preview != "",
      playsInline: image.paths.preview != "",
      src:
        image.paths.preview != ""
          ? image.paths.preview ?? ""
          : image.paths.thumbnail ?? "",
      alt: "",
      className: cx(
        "h-full object-cover min-w-[3rem] cursor-pointer opacity-60 transition-opacity hover:opacity-100 mx-1 border-2 border-transparent",
        {
          "!opacity-100 !border-white": i === index,
        }
      ),
      onClick: (e: React.MouseEvent) => selectIndex(e, i),
      role: "presentation",
      loading: "lazy",
      key: image.paths.thumbnail,
      onLoad: imageLoaded,
    })
  );

  const onDelayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let numberValue = Number.parseInt(e.currentTarget.value, 10);
    setDisplayedSlideshowInterval(e.currentTarget.value);

    // Without this exception, the blocking of updates for invalid values is even weirder
    if (e.currentTarget.value === "-" || e.currentTarget.value === "") {
      return;
    }

    numberValue =
      numberValue >= MIN_VALID_INTERVAL_SECONDS
        ? numberValue
        : MIN_VALID_INTERVAL_SECONDS;

    setSlideshowDelay(numberValue);

    if (slideshowInterval !== null) {
      setSlideshowInterval(numberValue * SECONDS_TO_MS);
    }
  };

  const currentIndex = index === null ? initialIndex : index;

  function gotoPage(imageIndex: number) {
    const indexInPage = (imageIndex - 1) % pageSize;
    if (pageCallback) {
      let jumppage = Math.floor((imageIndex - 1) / pageSize) + 1;
      if (page !== jumppage) {
        pageCallback({ page: jumppage });
        oldImages.current = images;
        setIsSwitchingPage(true);
      }
    }

    setIndex(indexInPage);
    setShowChapters(false);
  }

  // #2451: making OptionsForm an inline component means it
  // get re-rendered each time. This makes the text
  // field lose focus on input. Use function instead.
  function renderOptionsForm() {
    return (
      <Box sx={{ p: 2, minWidth: 300 }}>
        {slideshowEnabled ? (
          <Grid container spacing={2} alignItems="center" className="mb-2">
            <Grid size={{ xs: 4 }}>
              <Typography variant="body2">
                <FormattedMessage id="dialogs.lightbox.delay" />
              </Typography>
            </Grid>
            <Grid size={{ xs: 8 }}>
              <TextField
                type="number"
                variant="outlined"
                size="small"
                inputProps={{ min: 1 }}
                value={displayedSlideshowInterval ?? 0}
                onChange={onDelayChange}
                fullWidth
              />
            </Grid>
          </Grid>
        ) : undefined}

        <Grid container spacing={2} alignItems="center" className="mb-2">
          <Grid size={{ xs: 4 }}>
            <Typography variant="body2">
              <FormattedMessage id="dialogs.lightbox.display_mode.label" />
            </Typography>
          </Grid>
          <Grid size={{ xs: 8 }}>
            <TextField
              select
              size="small"
              variant="outlined"
              onChange={(e) =>
                setDisplayMode(e.target.value as GQL.ImageLightboxDisplayMode)
              }
              value={displayMode}
              fullWidth
              SelectProps={{
                MenuProps: {
                  style: { zIndex: 2200 },
                },
              }}
            >
              {Array.from(imageLightboxDisplayModeIntlMap.entries()).map(
                (v) => (
                  <MenuItem key={v[0]} value={v[0]}>
                    {intl.formatMessage({
                      id: v[1],
                    })}
                  </MenuItem>
                )
              )}
            </TextField>
          </Grid>
        </Grid>

        <Box mb={1}>
          <FormControlLabel
            control={
              <Checkbox
                checked={lightboxSettings?.scaleUp ?? false}
                disabled={displayMode === GQL.ImageLightboxDisplayMode.Original}
                onChange={(v) => setScaleUp(v.target.checked)}
              />
            }
            label={intl.formatMessage({
              id: "dialogs.lightbox.scale_up.label",
            })}
          />
          <FormHelperText>
            {intl.formatMessage({
              id: "dialogs.lightbox.scale_up.description",
            })}
          </FormHelperText>
        </Box>

        <Box mb={1}>
          <FormControlLabel
            control={
              <Checkbox
                checked={lightboxSettings?.resetZoomOnNav ?? false}
                onChange={(v) => setResetZoomOnNav(v.target.checked)}
              />
            }
            label={intl.formatMessage({
              id: "dialogs.lightbox.reset_zoom_on_nav",
            })}
          />
        </Box>

        <Box>
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 4 }}>
              <Typography variant="body2">
                <FormattedMessage id="dialogs.lightbox.scroll_mode.label" />
              </Typography>
            </Grid>
            <Grid size={{ xs: 8 }}>
              <TextField
                select
                size="small"
                variant="outlined"
                onChange={(e) =>
                  setScrollMode(e.target.value as GQL.ImageLightboxScrollMode)
                }
                value={
                  lightboxSettings?.scrollMode ??
                  GQL.ImageLightboxScrollMode.Zoom
                }
                fullWidth
                SelectProps={{
                  MenuProps: {
                    style: { zIndex: 2200 },
                  },
                }}
              >
                <MenuItem
                  value={GQL.ImageLightboxScrollMode.Zoom}
                  key={GQL.ImageLightboxScrollMode.Zoom}
                >
                  {intl.formatMessage({
                    id: "dialogs.lightbox.scroll_mode.zoom",
                  })}
                </MenuItem>
                <MenuItem
                  value={GQL.ImageLightboxScrollMode.PanY}
                  key={GQL.ImageLightboxScrollMode.PanY}
                >
                  {intl.formatMessage({
                    id: "dialogs.lightbox.scroll_mode.pan_y",
                  })}
                </MenuItem>
              </TextField>
            </Grid>
          </Grid>
          <FormHelperText>
            {intl.formatMessage({
              id: "dialogs.lightbox.scroll_mode.description",
            })}
          </FormHelperText>
        </Box>
      </Box>
    );
  }

  function renderBody() {
    if (images.length === 0 || isLoading || isSwitchingPage) {
      return <LoadingIndicator />;
    }

    const currentImage: ILightboxImage | undefined = images[currentIndex];
    const title = currentImage ? imageTitle(currentImage) : undefined;

    function setRating(v: number | null) {
      if (currentImage?.id) {
        updateImage({
          variables: {
            input: {
              id: currentImage.id,
              rating100: v,
            },
          },
        });
      }
    }

    async function onIncrementClick() {
      if (currentImage?.id === undefined) return;
      try {
        await mutateImageIncrementO(currentImage.id);
      } catch (e) {
        Toast.error(e);
      }
    }

    async function onDecrementClick() {
      if (currentImage?.id === undefined) return;
      try {
        await mutateImageDecrementO(currentImage.id);
      } catch (e) {
        Toast.error(e);
      }
    }

    async function onResetClick() {
      if (currentImage?.id === undefined) return;
      try {
        await mutateImageResetO(currentImage?.id);
      } catch (e) {
        Toast.error(e);
      }
    }

    const detailsNode = currentImage?.galleries?.length ? (
      <Link
        className="text-gray-300 hover:text-white flex items-center gap-1 inline-flex"
        to={`/galleries/${currentImage.galleries[0].id}`}
        onClick={() => close()}
      >
        <CollectionsIcon fontSize="inherit" sx={{ fontSize: "1.1em" }} />
        {galleryTitle(currentImage.galleries[0])}
      </Link>
    ) : undefined;

    return (
      <>
        <LightboxControls
          visible={true}
          image={currentImage}
          currentIndex={currentIndex}
          totalImages={images.length}
          onClose={close}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          showOptions={showOptions}
          onToggleOptions={() => setShowOptions(!showOptions)}
          chapters={chapters}
          onChapterClick={gotoPage}
          slideshowEnabled={slideshowEnabled}
          slideshowActive={slideshowInterval !== null}
          onToggleSlideshow={toggleSlideshow}
          zoom={zoom}
          onZoomChange={(z) => {
            setResetPosition(!resetPosition);
            setZoom(z); // LightboxControls currently only resets to 1
          }}
          onRatingChange={(v) => setRating(v)}
          onIncrementO={onIncrementClick}
          onDecrementO={onDecrementClick}
          title={title}
          details={detailsNode}
          optionsContent={renderOptionsForm()}
        />

        <div className="flex h-full transition relative justify-between">
          {allowNavigation && (
            <IconButton
              onClick={() => handleLeft(true)}
              className="d-none d-lg-block minimal z-[1045]"
              size="large"
              sx={{
                position: "absolute",
                left: 0,
                top: "50%",
                transform: "translateY(-50%)",
                "& svg": {
                  fontSize: "4rem",
                  opacity: 0.4,
                  "&:hover": { opacity: 1 },
                  filter: "drop-shadow(2px 2px 2px black)",
                },
              }}
            >
              <ChevronLeftIcon />
            </IconButton>
          )}

          <div
            className={cx("flex h-full absolute transition-all duration-400", {
              "duration-0": instantTransition,
            })}
            style={{ left: `${currentIndex * -100}vw`, width: `${images.length * 100}vw` }}
            ref={carouselRef}
          >
            {images.map((image, i) => (
              <div
                className="flex w-screen h-full justify-center items-center relative"
                key={image.paths.image}
                data-close-lightbox="true"
              >
                {i >= currentIndex - 1 && i <= currentIndex + 1 ? (
                  <LightboxImage
                    src={image.paths.image ?? ""}
                    width={image.visual_files?.[0]?.width ?? 0}
                    height={image.visual_files?.[0]?.height ?? 0}
                    displayMode={displayMode}
                    scaleUp={lightboxSettings?.scaleUp ?? false}
                    scrollMode={
                      lightboxSettings?.scrollMode ??
                      GQL.ImageLightboxScrollMode.Zoom
                    }
                    resetPosition={resetPosition}
                    zoom={i === currentIndex ? zoom : 1}
                    scrollAttemptsBeforeChange={scrollAttemptsBeforeChange}
                    firstScroll={firstScroll}
                    inScrollGroup={inScrollGroup}
                    current={i === currentIndex}
                    alignBottom={false}
                    setZoom={updateZoom}
                    debouncedScrollReset={debouncedScrollReset}
                    onLeft={handleLeft}
                    onRight={handleRight}
                    isVideo={isVideo(image.visual_files?.[0] ?? {})}
                  />
                ) : undefined}
              </div>
            ))}
          </div>

          {allowNavigation && (
            <IconButton
              onClick={() => handleRight(true)}
              className="d-none d-lg-block minimal z-[1045]"
              size="large"
              sx={{
                position: "absolute",
                right: 0,
                top: "50%",
                transform: "translateY(-50%)",
                "& svg": {
                  fontSize: "4rem",
                  opacity: 0.4,
                  "&:hover": { opacity: 1 },
                  filter: "drop-shadow(2px 2px 2px black)",
                },
              }}
            >
              <ChevronRightIcon />
            </IconButton>
          )}
        </div>

        {showNavigation && !isFullscreen && images.length > 1 && (
          <div
            className="flex flex-row shrink-0 h-40 mx-auto mb-8 px-40 relative transition-all duration-400 hidden lg:flex"
            style={navOffset}
            ref={navRef}
          >
            <IconButton
              onClick={() => setIndex(images.length - 1)}
              className="minimal z-[1045]"
              size="large"
              sx={{ "& svg": { fontSize: "4rem", opacity: 0.4, "&:hover": { opacity: 1 } } }}
            >
              <ArrowBackIcon sx={{ mr: 2 }} />
            </IconButton>
            {navItems}
            <IconButton
              onClick={() => setIndex(0)}
              className="minimal z-[1045]"
              size="large"
              sx={{ "& svg": { fontSize: "4rem", opacity: 0.4, "&:hover": { opacity: 1 } } }}
            >
              <ArrowForwardIcon sx={{ ml: 2 }} />
            </IconButton>
          </div>
        )}

        <LightboxFilmstrip
          visible={showFilmstrip}
          images={images}
          currentIndex={currentIndex}
          onSelect={setIndex}
        />
      </>
    );
  }

  if (!isVisible) {
    return <></>;
  }

  return (
    <div
      className="fixed inset-0 z-[1400] flex flex-col bg-black/80"
      role="presentation"
      ref={containerRef}
      onClick={handleClose}
      data-close-lightbox="true"
    >
      {renderBody()}
    </div>
  );
};

export default LightboxComponent;
