import React, { useState } from "react";
import { Box } from "@mui/material";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import * as GQL from "src/core/generated-graphql";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import TextUtils from "src/utils/text";
import { useGalleryLightbox } from "src/hooks/Lightbox/hooks";
import { galleryTitle } from "src/core/galleries";
import { RatingSystem } from "../Shared/Rating/RatingSystem";
import { GalleryPreviewScrubber } from "./GalleryPreviewScrubber";
import cx from "classnames";

const CLASSNAME = "GalleryWallCard";
const CLASSNAME_FOOTER = `${CLASSNAME}-footer`;
const CLASSNAME_IMG = `${CLASSNAME}-img`;
const CLASSNAME_TITLE = `${CLASSNAME}-title`;
const CLASSNAME_IMG_CONTAIN = `${CLASSNAME}-img-contain`;

interface IProps {
  gallery: GQL.SlimGalleryDataFragment;
  zoomIndex?: number;
}

type Orientation = "landscape" | "portrait";

function getOrientation(width: number, height: number): Orientation {
  return width > height ? "landscape" : "portrait";
}

// Heights in vh for zoom levels 0-4 (6 columns -> 2 columns approx)
const ZOOM_HEIGHTS = [15, 20, 25, 33, 50];

const GalleryWallCard: React.FC<IProps> = ({ gallery, zoomIndex = 0 }) => {
  const intl = useIntl();
  const [coverOrientation, setCoverOrientation] =
    React.useState<Orientation>("landscape");
  const [imageOrientation, setImageOrientation] =
    React.useState<Orientation>("landscape");
  const showLightbox = useGalleryLightbox(gallery.id, gallery.chapters);

  const cover = gallery?.paths.cover;

  function onCoverLoad(e: React.SyntheticEvent<HTMLImageElement, Event>) {
    const target = e.target as HTMLImageElement;
    setCoverOrientation(
      getOrientation(target.naturalWidth, target.naturalHeight)
    );
  }

  function onNonCoverLoad(e: React.SyntheticEvent<HTMLImageElement, Event>) {
    const target = e.target as HTMLImageElement;
    setImageOrientation(
      getOrientation(target.naturalWidth, target.naturalHeight)
    );
  }

  const [imgSrc, setImgSrc] = useState<string | undefined>(cover ?? undefined);
  const title = galleryTitle(gallery);
  const performerNames = gallery.performers.map((p) => p.name);
  const performers =
    performerNames.length >= 2
      ? [...performerNames.slice(0, -2), performerNames.slice(-2).join(" & ")]
      : performerNames;

  async function showLightboxStart() {
    if (gallery.image_count === 0) {
      return;
    }

    showLightbox(0);
  }

  const imgClassname =
    imageOrientation !== coverOrientation ? CLASSNAME_IMG_CONTAIN : "";

  const zoomHeight = ZOOM_HEIGHTS[zoomIndex] ?? 20;

  return (
    <Box
      component="section"
      className={cx(CLASSNAME, `${CLASSNAME}-${coverOrientation}`, "stash-gallery-wall-card")}
      onClick={showLightboxStart}
      onKeyPress={showLightboxStart}
      role="button"
      tabIndex={0}
      sx={{
        height: `${zoomHeight}vh`,
        padding: "2px",
        position: "relative",
        flexGrow: coverOrientation === "landscape" ? 2 : 1,
        width: "auto",
        minWidth: "150px", // Prevent too small squish
        maxWidth: "96vw", // Prevent overflow on single item
        "& .rating-stars, & .rating-number": {
          position: "absolute",
          right: "1rem",
          textShadow: "1px 1px 3px black",
          top: "1rem",
          zIndex: 2
        }
      }}
    >
      <RatingSystem value={gallery.rating100} disabled withoutContext />
      <Box
        component="img"
        loading="lazy"
        src={imgSrc}
        alt=""
        className={cx(CLASSNAME_IMG, imgClassname)}
        // set orientation based on cover only
        onLoad={imgSrc === cover ? onCoverLoad : onNonCoverLoad}
        sx={{
          height: "100%",
          objectFit: imgClassname ? "contain" : "cover",
          objectPosition: imgClassname ? "initial" : "center 20%",
          width: "100%",
          "&.GalleryWallCard-img-contain": {
            objectFit: "contain",
            objectPosition: "initial"
          }
        }}
      />
      <Box
        className="lineargradient"
        sx={{
          backgroundImage: "linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.3))",
          bottom: "100px",
          height: "100px",
          position: "relative"
        }}
      >
        <Box
          component="footer"
          className={CLASSNAME_FOOTER}
          sx={{
            bottom: "20px",
            padding: "1rem",
            position: "absolute",
            textShadow: "1px 1px 3px black",
            transition: "0s opacity",
            width: "100%",
            zIndex: 2,
            opacity: { xs: 1, md: 0 },
            "& .TruncatedText": {
              fontWeight: "bold"
            },
            "&:hover": {
              "& .GalleryWallCard-title": {
                textDecoration: "underline"
              },
              opacity: 1,
              transition: "1s opacity",
              transitionDelay: "500ms"
            }
          }}
        >
          <Link
            to={`/galleries/${gallery.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ color: "white", textDecoration: "none" }}
          >
            {title && (
              <TruncatedText
                text={title}
                lineCount={1}
                className={CLASSNAME_TITLE}
              />
            )}
            <TruncatedText text={performers.join(", ")} />
            <Box>
              {gallery.date && TextUtils.formatFuzzyDate(intl, gallery.date)}
            </Box>
          </Link>
        </Box>
        <GalleryPreviewScrubber
          previewPath={gallery.paths.preview}
          defaultPath={cover ?? ""}
          imageCount={gallery.image_count}
          onClick={(i) => {
            showLightbox(i);
          }}
          onPathChanged={setImgSrc}
        />
      </Box>
    </Box>
  );
};

export default GalleryWallCard;
