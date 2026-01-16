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
import { LightboxFilmstrip } from "./LightboxFilmstrip";
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

const CLASSNAME = "Lightbox";
const CLASSNAME_HEADER = `${CLASSNAME}-header`;
const CLASSNAME_LEFT_SPACER = `${CLASSNAME_HEADER}-left-spacer`;
const CLASSNAME_CHAPTERS = `${CLASSNAME_HEADER}-chapters`;
const CLASSNAME_CHAPTER_BUTTON = `${CLASSNAME_HEADER}-chapter-button`;
const CLASSNAME_INDICATOR = `${CLASSNAME_HEADER}-indicator`;
const CLASSNAME_OPTIONS = `${CLASSNAME_HEADER}-options`;
const CLASSNAME_OPTIONS_ICON = `${CLASSNAME_OPTIONS}-icon`;
const CLASSNAME_OPTIONS_INLINE = `${CLASSNAME_OPTIONS}-inline`;
const CLASSNAME_RIGHT = `${CLASSNAME_HEADER}-right`;
const CLASSNAME_FOOTER = `${CLASSNAME}-footer`;
const CLASSNAME_FOOTER_LEFT = `${CLASSNAME_FOOTER}-left`;
const CLASSNAME_FOOTER_CENTER = `${CLASSNAME_FOOTER}-center`;
const CLASSNAME_FOOTER_RIGHT = `${CLASSNAME_FOOTER}-right`;
const CLASSNAME_DISPLAY = `${CLASSNAME}-display`;
const CLASSNAME_CAROUSEL = `${CLASSNAME}-carousel`;
const CLASSNAME_INSTANT = `${CLASSNAME_CAROUSEL}-instant`;
const CLASSNAME_IMAGE = `${CLASSNAME_CAROUSEL}-image`;
const CLASSNAME_NAVBUTTON = `${CLASSNAME}-navbutton`;
const CLASSNAME_RIGHTBUTTON = `${CLASSNAME}-rightbutton`;
const CLASSNAME_NAV = `${CLASSNAME}-nav`;
const CLASSNAME_NAVIMAGE = `${CLASSNAME_NAV}-image`;
const CLASSNAME_NAVSELECTED = `${CLASSNAME_NAV}-selected`;

const DEFAULT_SLIDESHOW_DELAY = 5000;
const SECONDS_TO_MS = 1000;
const MIN_VALID_INTERVAL_SECONDS = 1;
const MIN_ZOOM = 0.1;
const SCROLL_ZOOM_TIMEOUT = 250;
const ZOOM_NONE_EPSILON = 0.015;

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
    const { className } = e.target as Element;
    if (className && className.includes && className.includes(CLASSNAME_IMAGE))
      close();
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
      className: cx(CLASSNAME_NAVIMAGE, {
        [CLASSNAME_NAVSELECTED]: i === index,
      }),
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

  function chapterHeader() {
    const imageNumber = (index ?? 0) + 1;
    const globalIndex = page
      ? (page - 1) * pageSize + imageNumber
      : imageNumber;

    let chapterTitle = "";
    chapters.forEach(function (chapter) {
      if (chapter.image_index > globalIndex) {
        return;
      }
      chapterTitle = chapter.title;
    });

    return chapterTitle ?? "";
  }

  const [anchorElChapters, setAnchorElChapters] = useState<null | HTMLElement>(null);

  const renderChapterMenu = () => {
    if (chapters.length <= 0) return;

    const handleChapterClick = (imageIndex: number) => {
      gotoPage(imageIndex);
      setAnchorElChapters(null);
    };

    return (
      <>
        <IconButton
          onClick={(e) => setAnchorElChapters(e.currentTarget)}
          className={`minimal ${CLASSNAME_CHAPTER_BUTTON}`}
          size="small"
        >
          {showChapters ? <CloseIcon fontSize="small" /> : <MenuIcon fontSize="small" />}
        </IconButton>
        <Menu
          anchorEl={anchorElChapters}
          open={Boolean(anchorElChapters)}
          onClose={() => setAnchorElChapters(null)}
          className={`${CLASSNAME_CHAPTERS}`}
        >
          {chapters.map(({ id, title, image_index }) => (
            <MenuItem key={id} onClick={() => handleChapterClick(image_index)}>
              {title}
              {title.length > 0 ? " - #" : "#"}
              {image_index}
            </MenuItem>
          ))}
        </Menu>
      </>
    );
  };

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

    const pageHeader =
      page && pages
        ? intl.formatMessage(
          { id: "dialogs.lightbox.page_header" },
          { page, total: pages }
        )
        : "";

    return (
      <>
        <div className={CLASSNAME_HEADER}>
          <div className={CLASSNAME_LEFT_SPACER}>{renderChapterMenu()}</div>
          <div className={CLASSNAME_INDICATOR}>
            <span>
              {chapterHeader()} {pageHeader}
            </span>
            {images.length > 1 ? (
              <b ref={indicatorRef}>{`${currentIndex + 1} / ${images.length
                }`}</b>
            ) : undefined}
          </div>
          <div className={CLASSNAME_RIGHT}>
            <div className={CLASSNAME_OPTIONS}>
              <div className={CLASSNAME_OPTIONS_ICON}>
                <IconButton
                  ref={overlayTarget}
                  title={intl.formatMessage({
                    id: "dialogs.lightbox.options",
                  })}
                  onClick={() => setShowOptions(!showOptions)}
                  size="large"
                  className="minimal"
                >
                  <SettingsIcon />
                </IconButton>
                <Popover
                  open={showOptions}
                  anchorEl={overlayTarget.current}
                  onClose={() => setShowOptions(false)}
                  anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'center',
                  }}
                  transformOrigin={{
                    vertical: 'bottom',
                    horizontal: 'center',
                  }}
                >
                  <Box p={2}>
                    <Typography variant="h6" gutterBottom>
                      {intl.formatMessage({
                        id: "dialogs.lightbox.options",
                      })}
                    </Typography>
                    {renderOptionsForm()}
                  </Box>
                </Popover>
              </div>
              <Box className={CLASSNAME_OPTIONS_INLINE}>
                {renderOptionsForm()}
              </Box>
            </div>
            {slideshowEnabled && (
              <IconButton
                onClick={toggleSlideshow}
                title="Toggle Slideshow"
                size="large"
                className="minimal"
              >
                {slideshowInterval !== null ? <PauseIcon /> : <PlayArrowIcon />}
              </IconButton>
            )}
            {zoom !== 1 && (
              <IconButton
                onClick={() => {
                  setResetPosition(!resetPosition);
                  setZoom(1);
                }}
                title="Reset zoom"
                size="large"
                className="minimal"
              >
                <ZoomOutIcon />
              </IconButton>
            )}
            {document.fullscreenEnabled && (
              <IconButton
                onClick={toggleFullscreen}
                title="Toggle Fullscreen"
                size="large"
                className="minimal"
              >
                <FullscreenIcon />
              </IconButton>
            )}
            <IconButton
              onClick={() => close()}
              title="Close Lightbox"
              size="large"
              className="minimal"
            >
              <CloseIcon />
            </IconButton>
          </div>
        </div>
        <div className={CLASSNAME_DISPLAY}>
          {allowNavigation && (
            <IconButton
              onClick={handleLeft}
              className={`${CLASSNAME_NAVBUTTON} d-none d-lg-block minimal`}
              size="large"
            >
              <ChevronLeftIcon />
            </IconButton>
          )}

          <div
            className={cx(CLASSNAME_CAROUSEL, {
              [CLASSNAME_INSTANT]: instantTransition,
            })}
            style={{ left: `${currentIndex * -100}vw` }}
            ref={carouselRef}
          >
            {images.map((image, i) => (
              <div className={`${CLASSNAME_IMAGE}`} key={image.paths.image}>
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
                    alignBottom={movingLeft}
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
              onClick={handleRight}
              className={`${CLASSNAME_NAVBUTTON} ${CLASSNAME_RIGHTBUTTON} d-none d-lg-block minimal`}
              size="large"
            >
              <ChevronRightIcon />
            </IconButton>
          )}
        </div>
        {showNavigation && !isFullscreen && images.length > 1 && (
          <div className={CLASSNAME_NAV} style={navOffset} ref={navRef}>
            <IconButton
              onClick={() => setIndex(images.length - 1)}
              className={`${CLASSNAME_NAVBUTTON} minimal`}
              size="large"
            >
              <ArrowBackIcon sx={{ mr: 2 }} />
            </IconButton>
            {navItems}
            <IconButton
              onClick={() => setIndex(0)}
              className={`${CLASSNAME_NAVBUTTON} minimal`}
              size="large"
            >
              <ArrowForwardIcon sx={{ ml: 2 }} />
            </IconButton>
          </div>
        )}
        <div className={CLASSNAME_FOOTER}>
          <div className={CLASSNAME_FOOTER_LEFT}>
            {currentImage?.id !== undefined && (
              <>
                <div>
                  <OCounterButton
                    onDecrement={onDecrementClick}
                    onIncrement={onIncrementClick}
                    onReset={onResetClick}
                    value={currentImage?.o_counter ?? 0}
                  />
                </div>
                <RatingSystem
                  value={currentImage?.rating100}
                  onSetRating={(v) => setRating(v)}
                  clickToRate
                  withoutContext
                />
              </>
            )}
          </div>
          <div className={CLASSNAME_FOOTER_CENTER}>
            {currentImage && (
              <>
                <Link
                  className="image-link"
                  to={`/images/${currentImage.id}`}
                  onClick={() => close()}
                >
                  {title ?? ""}
                </Link>
                {currentImage.galleries?.length ? (
                  <Link
                    className="image-gallery-link"
                    to={`/galleries/${currentImage.galleries[0].id}`}
                    onClick={() => close()}
                  >
                    <CollectionsIcon fontSize="small" sx={{ mr: 0.5 }} />
                    {galleryTitle(currentImage.galleries[0])}
                  </Link>
                ) : null}
              </>
            )}
          </div>
          <div className={CLASSNAME_FOOTER_RIGHT}></div>
        </div>
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
      className={CLASSNAME}
      role="presentation"
      ref={containerRef}
      onClick={handleClose}
    >
      {renderBody()}
    </div>
  );
};

export default LightboxComponent;
