import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { useLightbox } from "src/hooks/Lightbox/hooks";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import Gallery, { PhotoClickHandler } from "react-photo-gallery";
import "flexbin/flexbin.css";
import * as GQL from "src/core/generated-graphql";

interface IProps {
  galleryId: string;
}

export const GalleryViewer: React.FC<IProps> = ({ galleryId }) => {
  const pageSize = 200;
  const [currentPage, setCurrentPage] = useState(1);
  const [loadedImages, setLoadedImages] =
    useState<GQL.FindImagesQuery["findImages"]["images"]>([]);

  useEffect(() => {
    setCurrentPage(1);
    setLoadedImages([]);
  }, [galleryId]);

  const currentFilter = useMemo(() => {
    return {
      page: currentPage,
      per_page: pageSize,
      sort: "path",
    };
  }, [currentPage, pageSize]);

  const { data, previousData, loading } = GQL.useFindImagesQuery({
    notifyOnNetworkStatusChange: true,
    variables: {
      filter: currentFilter,
      image_filter: {
        galleries: {
          modifier: GQL.CriterionModifier.Includes,
          value: [galleryId],
        },
      },
    },
  });

  useEffect(() => {
    const pageImages = data?.findImages?.images;
    if (!pageImages) {
      return;
    }

    setLoadedImages((previous) => {
      if (currentPage === 1) {
        return pageImages;
      }

      const seen = new Set(previous.map((image) => image.id));
      const merged = [...previous];
      pageImages.forEach((image) => {
        if (!seen.has(image.id)) {
          merged.push(image);
          seen.add(image.id);
        }
      });

      return merged;
    });
  }, [data, currentPage]);

  const totalCount = data?.findImages?.count ?? previousData?.findImages?.count ?? 0;
  const hasMore = loadedImages.length < totalCount;
  const isInitialLoading = loading && loadedImages.length === 0;

  const lightboxState = useMemo(() => {
    return {
      images: loadedImages,
      showNavigation: false,
      showFilmstrip: true,
    };
  }, [loadedImages]);

  const showLightbox = useLightbox(lightboxState);
  const showLightboxOnClick: PhotoClickHandler = useCallback(
    (event, { index }) => {
      showLightbox({ initialIndex: index });
    },
    [showLightbox]
  );

  if (isInitialLoading) return <LoadingIndicator />;

  let photos: {
    src: string;
    srcSet?: string | string[] | undefined;
    sizes?: string | string[] | undefined;
    width: number;
    height: number;
    alt?: string | undefined;
    key?: string | undefined;
  }[] = [];

  loadedImages.forEach((image, index) => {
    let imageData = {
      src: image.paths.thumbnail!,
      width: image.visual_files[0]?.width ?? 0,
      height: image.visual_files[0]?.height ?? 0,
      tabIndex: index,
      key: image.id ?? index,
      loading: "lazy",
      className: "gallery-image",
      alt: image.title ?? index.toString(),
    };
    photos.push(imageData);
  });

  return (
    <Box
      className="gallery"
      sx={{
        "& .gallery-image": {
          cursor: "pointer"
        }
      }}
    >
      <Gallery photos={photos} onClick={showLightboxOnClick} margin={2.5} />

      <Box display="flex" justifyContent="center" alignItems="center" flexDirection="column" mt={2} gap={1}>
        <Typography variant="body2" color="text.secondary">
          Showing {loadedImages.length} of {totalCount} images
        </Typography>
        {hasMore && (
          <Button
            variant="outlined"
            onClick={() => setCurrentPage((previous) => previous + 1)}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load More"}
          </Button>
        )}
      </Box>
    </Box>
  );
};

export default GalleryViewer;
