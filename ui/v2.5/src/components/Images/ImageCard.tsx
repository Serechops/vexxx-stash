import React, { useMemo } from "react";
import { Button, Box, Typography } from "@mui/material";
import { Link, useHistory } from "react-router-dom";
import TextUtils from "src/utils/text";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { GalleryLink, TagLink } from "src/components/Shared/TagLink";
import { HoverPopover } from "src/components/Shared/HoverPopover";
import { PerformerPopoverButton } from "src/components/Shared/PerformerPopoverButton";
import { GridCard } from "src/components/Shared/GridCard/GridCard";
import { RatingBanner } from "src/components/Shared/RatingBanner";
import InventoryIcon from "@mui/icons-material/Inventory";
import CollectionsIcon from "@mui/icons-material/Collections";
import SearchIcon from "@mui/icons-material/Search";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import { imageTitle } from "src/core/files";
import { PatchComponent } from "src/patch";
import { TruncatedText } from "../Shared/TruncatedText";
import { StudioOverlay } from "../Shared/GridCard/StudioOverlay";
import { OCounterButton } from "../Shared/CountButton";

interface IImageCardProps {
  image: GQL.SlimImageDataFragment;
  cardWidth?: number;
  selecting?: boolean;
  selected?: boolean | undefined;
  zoomIndex: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
  onPreview?: (ev: React.MouseEvent<HTMLButtonElement> | React.MouseEvent) => void;
}

export const ImageCard: React.FC<IImageCardProps> = PatchComponent(
  "ImageCard",
  (props: IImageCardProps) => {
    const {
      image,
      cardWidth,
      selecting,
      selected,
      onSelectedChanged,
      zoomIndex,
      onPreview,
    } = props;

    const [isHovered, setIsHovered] = React.useState(false);
    const history = useHistory();   // Ensure useHistory is imported or available? It wasn't in original file imports, strictly speaking. 
    // Ah, GridCard handles navigation usually. We need to import useHistory from react-router-dom.
    // Checking original imports: no useHistory. I need to add it.

    const file = useMemo(
      () =>
        image.visual_files.length > 0
          ? image.visual_files[0]
          : undefined,
      [image]
    );

    const source =
      image.paths.preview != ""
        ? image.paths.preview ?? ""
        : image.paths.thumbnail ?? "";
    const video = source.includes("preview");
    const ImagePreview = video ? "video" : "img";

    const rating = image.rating100 ? Math.round(image.rating100 / 20 * 10) / 10 : null;
    const resolution = file?.width && file?.height ? TextUtils.resolution(file.width, file.height) : null;

    const handleCardClick = (e: React.MouseEvent) => {
      if (selecting && onSelectedChanged) {
        onSelectedChanged(!selected, e.shiftKey);
        e.preventDefault();
      } else if (!selecting) {
        // Let Link handle it usually, but if we use Div we need explicit nav.
        // OverlayCard uses Div + Link inside.
      }
    };

    const LinkComponent = selecting ? "div" : Link;
    const linkProps = selecting ? {} : { to: `/images/${image.id}` };

    return (
      <Box
        className={cx("image-card", { "selected": selected })}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
        sx={{
          position: "relative",
          borderRadius: "12px",
          overflow: "hidden",
          backgroundColor: "grey.900",
          transition: "all 0.3s ease",
          height: "100%",
          width: cardWidth ? cardWidth : "100%",
          "&:hover": {
            transform: "scale(1.02)",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
            zIndex: 20,
            "& .overlay-content": {
              background: "linear-gradient(to top, rgba(0, 0, 0, 0.95) 20%, rgba(0, 0, 0, 0.7) 60%, transparent 100%)",
            }
          },
          "&.selected": {
            boxShadow: (theme) => `0 0 0 3px ${theme.palette.primary.main}`,
          }
        }}
      >
        <Link
          to={selecting ? "#" : `/images/${image.id}`}
          onClick={(e) => {
            if (selecting) {
              e.preventDefault();
            }
          }}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%', width: '100%' }}
        >
          {/* Media Container: Full Bleed */}
          <Box
            className="overlay-media"
            sx={{
              position: "relative",
              width: "100%",
              height: "100%",
              aspectRatio: "4/3",
              bgcolor: "black",
            }}
          >
            <Box
              component={ImagePreview}
              {...(video ? { loop: true, autoPlay: true, playsInline: true, muted: true } : {})}
              className="image-card-preview-image"
              alt={image.title ?? ""}
              src={source}
              sx={{
                height: "100%",
                width: "100%",
                objectFit: "cover",
                objectPosition: "center",
                display: "block"
              }}
            />

            {onPreview && (
              <Box
                sx={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 25,
                  opacity: 0,
                  transition: "opacity 0.2s",
                  "&:hover": { opacity: 1 },
                  ".image-card:hover &": { opacity: 0.8 }
                }}
              >
                <Button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPreview(e);
                  }}
                  sx={{ color: "white", minWidth: 0, borderRadius: "50%", p: 1, bgcolor: "rgba(0,0,0,0.5)" }}
                >
                  <SearchIcon fontSize="large" />
                </Button>
              </Box>
            )}
          </Box>

          {/* Gradient Overlay & Content */}
          <Box
            className="overlay-content"
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background: "linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%)",
              padding: "12px",
              color: "#fff",
              transition: "background 0.3s ease",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 700,
                  lineHeight: 1.2,
                  textShadow: "0 2px 4px rgba(0, 0, 0, 0.8)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "1rem"
                }}
              >
                {imageTitle(image)}
              </Typography>

              <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.8rem", color: "rgba(255,255,255,0.8)" }}>
                {image.date && <span>{image.date}</span>}
                {resolution && (
                  <span style={{ fontSize: "0.75rem", padding: "2px 4px", background: "rgba(255,255,255,0.2)", borderRadius: "4px" }}>
                    {resolution}
                  </span>
                )}
                {image.o_counter && (
                  <span style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    <LocalOfferIcon sx={{ fontSize: 14 }} /> {image.o_counter}
                  </span>
                )}
              </Box>
            </Box>

            {/* Expanded Content (Slide Up) */}
            <Box
              className={cx("overlay-slide-content", { visible: isHovered })}
              sx={{
                maxHeight: 0,
                overflow: "hidden",
                opacity: 0,
                transition: "all 0.3s ease-in-out",
                "&.visible": {
                  maxHeight: "100px",
                  opacity: 1,
                  mt: "8px",
                }
              }}
            >
              {/* Performers */}
              {image.performers.length > 0 && (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: "4px", mb: "4px" }}>
                  {image.performers.slice(0, 4).map(p => (
                    <Box
                      component="span"
                      key={p.id}
                      sx={{
                        background: "rgba(255, 255, 255, 0.2)",
                        backdropFilter: "blur(4px)",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      {p.image_path && <img src={p.image_path} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }} />}
                      {p.name}
                    </Box>
                  ))}
                </Box>
              )}
              {/* Tags */}
              {image.tags.length > 0 && (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {image.tags.slice(0, 3).map(t => (
                    <Box key={t.id} sx={{ fontSize: "0.7rem", color: "rgba(255, 255, 255, 0.6)" }}>
                      #{t.name}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        </Link>

        {/* Top Section: Rating & Studio */}
        <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, p: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 10, pointerEvents: "none" }}>
          <Box sx={{ display: "flex", gap: 0.5, pointerEvents: "auto" }}>
            <RatingBanner rating={image.rating100} />
          </Box>
          <Box sx={{ pointerEvents: "auto" }}>
            <StudioOverlay studio={image.studio} />
          </Box>
        </Box>

        {/* Selecting Checkbox */}
        {selecting && (
          <Box sx={{ position: "absolute", top: "0.5rem", left: "0.5rem", zIndex: 30 }}>
            <input
              type="checkbox"
              checked={selected}
              readOnly
              style={{ cursor: "pointer", height: "1.25rem", width: "1.25rem" }}
            />
          </Box>
        )}
      </Box>
    );
  }
);
