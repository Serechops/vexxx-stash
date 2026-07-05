import React, { useCallback, useState, useMemo, MouseEvent, useEffect } from "react";
import { FormattedNumber, useIntl } from "react-intl";
import cloneDeep from "lodash-es/cloneDeep";
import { useHistory } from "react-router-dom";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import {
  queryFindImages,
  useFindImages,
  useFindImagesMetadata,
} from "src/core/StashService";
import { ItemListContext, showWhenSelected } from "../List/ItemList";
import { useLightbox } from "src/hooks/Lightbox/hooks";
import { ListFilterModel } from "src/models/list-filter/filter";
import { DisplayMode } from "src/models/list-filter/types";

import { ImageWallItem } from "./ImageWallItem";
import { useShowEditFilter } from "src/components/List/EditFilterDialog";
import { EditImagesDialog } from "./EditImagesDialog";
import { DeleteImagesDialog } from "./DeleteImagesDialog";
import "flexbin/flexbin.css";
import Gallery, { RenderImageProps } from "react-photo-gallery";
import { ExportDialog } from "../Shared/ExportDialog";
import { objectTitle } from "src/core/files";
import { useConfigurationContext } from "src/hooks/Config";
import { SmartImageGridCard } from "./VirtualizedImageGridCard";
import { View } from "../List/views";
import { IItemListOperation, FilteredListToolbar } from "../List/FilteredListToolbar";
import { FileSize } from "../Shared/FileSize";
import { PatchComponent, PatchContainerComponent } from "src/patch";
import { GenerateDialog } from "../Dialogs/GenerateDialog";
import { FilterTags } from "../List/FilterTags";
import { PagedList } from "../List/PagedList";
import { useFilterOperations } from "../List/util";
import { useFilter } from "../List/FilterProvider";
import { useListContext, useQueryResultContext } from "../List/ListProvider";
import { useModal } from "src/hooks/modal";
import { Box } from "@mui/material";
import { Pagination, PaginationIndex } from "../List/Pagination";
import {
  InlineFilterPanel,
  SidebarStateContext,
  useSidebarState,
} from "../Shared/Sidebar";
import { useFilteredSidebarKeybinds } from "../List/Filters/FilterSidebar";
import { SidebarStudiosFilter } from "../List/Filters/StudiosFilter";
import { SidebarPerformersFilter } from "../List/Filters/PerformersFilter";
import { SidebarTagsFilter } from "../List/Filters/TagsFilter";
import { SidebarRatingFilter } from "../List/Filters/RatingFilter";
import { StudiosCriterionOption } from "src/models/list-filter/criteria/studios";
import { PerformersCriterionOption } from "src/models/list-filter/criteria/performers";
import { TagsCriterionOption } from "src/models/list-filter/criteria/tags";
import { RatingCriterionOption } from "src/models/list-filter/criteria/rating";
import { FormattedMessage } from "react-intl";

interface IImageWallProps {
  images: GQL.SlimImageDataFragment[];
  onChangePage: (page: number) => void;
  currentPage: number;
  pageCount: number;
  handleImageOpen: (index: number) => void;
  zoomIndex: number;
  forceRowDirection?: boolean;
}

const zoomWidths = [280, 340, 420, 560, 800];
const breakpointZoomHeights = [
  { minWidth: 576, heights: [100, 120, 240, 360] },
  { minWidth: 768, heights: [120, 160, 240, 480] },
  { minWidth: 1200, heights: [120, 160, 240, 300] },
  { minWidth: 1400, heights: [160, 240, 300, 480] },
];

const ImageWall: React.FC<IImageWallProps> = ({
  images,
  zoomIndex,
  handleImageOpen,
  forceRowDirection,
}) => {
  const { configuration } = useConfigurationContext();
  const uiConfig = configuration?.ui;

  const containerRef = React.useRef<HTMLDivElement>(null);

  let photos: {
    src: string;
    srcSet?: string | string[] | undefined;
    sizes?: string | string[] | undefined;
    width: number;
    height: number;
    alt?: string | undefined;
    key?: string | undefined;
  }[] = [];

  images.forEach((image, index) => {
    let imageData = {
      src:
        image.paths.preview != ""
          ? image.paths.preview!
          : image.paths.thumbnail!,
      width: image.visual_files?.[0]?.width ?? 0,
      height: image.visual_files?.[0]?.height ?? 0,
      tabIndex: index,
      key: image.id,
      loading: "lazy" as const,
      className: "gallery-image",
      alt: objectTitle(image),
    };
    photos.push(imageData);
  });

  const showLightboxOnClick = useCallback(
    (event, { index }) => {
      handleImageOpen(index);
    },
    [handleImageOpen]
  );

  function columns(containerWidth: number) {
    let preferredSize = zoomWidths[zoomIndex];
    let columnCount = containerWidth / preferredSize;
    return Math.round(columnCount);
  }

  const targetRowHeight = useCallback(
    (containerWidth: number) => {
      let zoomHeight = 280;
      breakpointZoomHeights.forEach((e) => {
        if (containerWidth >= e.minWidth) {
          zoomHeight = e.heights[zoomIndex];
        }
      });
      return zoomHeight;
    },
    [zoomIndex]
  );

  const maxHeightFactor = 1.3;

  const renderImage = useCallback(
    (props: RenderImageProps) => {
      const maxHeight =
        props.direction === "column"
          ? props.photo.height
          : targetRowHeight(containerRef.current?.offsetWidth ?? 0) *
          maxHeightFactor;
      return <ImageWallItem {...props} maxHeight={maxHeight} />;
    },
    [targetRowHeight]
  );

  return (
    <div className="gallery" ref={containerRef}>
      {photos.length ? (
        <Gallery
          photos={photos}
          renderImage={renderImage}
          onClick={showLightboxOnClick}
          margin={uiConfig?.imageWallOptions?.margin!}
          direction={forceRowDirection ? "row" : (uiConfig?.imageWallOptions?.direction!)}
          columns={columns}
          targetRowHeight={targetRowHeight}
        />
      ) : null}
    </div>
  );
};

interface IImageListImages {
  images: GQL.SlimImageDataFragment[];
  filter: ListFilterModel;
  selectedIds: Set<string>;
  onChangePage: (page: number) => void;
  pageCount: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  slideshowRunning: boolean;
  setSlideshowRunning: (running: boolean) => void;
  chapters?: GQL.GalleryChapterDataFragment[];
  loading?: boolean;
}

const ImageListImages: React.FC<IImageListImages> = ({
  images,
  filter,
  selectedIds,
  onChangePage,
  pageCount,
  onSelectChange,
  slideshowRunning,
  setSlideshowRunning,
  chapters = [],
  loading,
}) => {
  const handleLightBoxPage = useCallback(
    (props: { direction?: number; page?: number }) => {
      const { direction, page: newPage } = props;

      if (direction !== undefined) {
        if (direction < 0) {
          if (filter.currentPage === 1) {
            onChangePage(pageCount);
          } else {
            onChangePage(filter.currentPage + direction);
          }
        } else if (direction > 0) {
          if (filter.currentPage === pageCount) {
            onChangePage(1);
          } else {
            onChangePage(filter.currentPage + direction);
          }
        }
      } else if (newPage !== undefined) {
        onChangePage(newPage);
      }
    },
    [onChangePage, filter.currentPage, pageCount]
  );

  const handleClose = useCallback(() => {
    setSlideshowRunning(false);
  }, [setSlideshowRunning]);

  const lightboxState = useMemo(() => {
    return {
      images,
      showNavigation: filter.displayMode !== DisplayMode.Grid,
      showFilmstrip: filter.displayMode === DisplayMode.Grid,
      pageCallback: pageCount > 1 ? handleLightBoxPage : undefined,
      page: filter.currentPage,
      pages: pageCount,
      pageSize: filter.itemsPerPage,
      slideshowEnabled: slideshowRunning,
      onClose: handleClose,
    };
  }, [
    images,
    pageCount,
    filter.currentPage,
    filter.itemsPerPage,
    filter.displayMode,
    slideshowRunning,
    handleClose,
    handleLightBoxPage,
  ]);

  const showLightbox = useLightbox(
    lightboxState,
    filter.sortBy === "path" &&
      filter.sortDirection === GQL.SortDirectionEnum.Asc
      ? chapters.map((c) => ({ ...c, title: c.title ?? "" }))
      : []
  );

  const handleImageOpen = useCallback(
    (index) => {
      setSlideshowRunning(true);
      showLightbox({ initialIndex: index, slideshowEnabled: true });
    },
    [showLightbox, setSlideshowRunning]
  );

  function onPreview(index: number, ev: MouseEvent) {
    handleImageOpen(index);
    ev.preventDefault();
  }

  if (filter.displayMode === DisplayMode.Grid) {
    return (
      <SmartImageGridCard
        images={images}
        selectedIds={selectedIds}
        zoomIndex={filter.zoomIndex}
        itemsPerPage={filter.itemsPerPage}
        onSelectChange={onSelectChange}
        onPreview={onPreview}
        loading={loading}
        virtualizationThreshold={50}
      />
    );
  }
  if (filter.displayMode === DisplayMode.Wall) {
    return (
      <ImageWall
        images={images}
        onChangePage={onChangePage}
        currentPage={filter.currentPage}
        pageCount={pageCount}
        handleImageOpen={handleImageOpen}
        zoomIndex={filter.zoomIndex}
      />
    );
  }
  if (filter.displayMode === DisplayMode.Justified) {
    return (
      <ImageWall
        images={images}
        onChangePage={onChangePage}
        currentPage={filter.currentPage}
        pageCount={pageCount}
        handleImageOpen={handleImageOpen}
        zoomIndex={filter.zoomIndex}
        forceRowDirection
      />
    );
  }

  return <></>;
};

function getItems(result: GQL.FindImagesQueryResult) {
  return result?.data?.findImages?.images ?? [];
}

function getCount(result: GQL.FindImagesQueryResult) {
  return result?.data?.findImages?.count ?? 0;
}

function renderMetadataByline(
  result: GQL.FindImagesQueryResult,
  metadataInfo?: GQL.FindImagesMetadataQueryResult
) {
  const megapixels = metadataInfo?.data?.findImages?.megapixels;
  const size = metadataInfo?.data?.findImages?.filesize;

  if (metadataInfo?.loading) {
    return <span className="images-stats">&nbsp;(...)</span>;
  }

  if (!megapixels && !size) {
    return;
  }

  const separator = megapixels && size ? " - " : "";

  return (
    <span className="images-stats">
      &nbsp;(
      {megapixels ? (
        <span className="images-megapixels">
          <FormattedNumber value={megapixels} /> Megapixels
        </span>
      ) : undefined}
      {separator}
      {size ? (
        <span className="images-size">
          <FileSize size={size} />
        </span>
      ) : undefined}
      )
    </span>
  );
}

const ImageFilterSidebarSections = PatchContainerComponent(
  "FilteredImageList.SidebarSections"
);

const SidebarContent: React.FC<{
  filter: ListFilterModel;
  setFilter: (filter: ListFilterModel) => void;
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  view?: View;
}> = ({ filter, setFilter, filterHook, view }) => {
  const hideStudios = view === View.StudioImages;
  const hidePerformers = view === View.PerformerImages;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <ImageFilterSidebarSections>
        {!hideStudios && (
          <SidebarStudiosFilter
            title={<FormattedMessage id="studios" />}
            option={StudiosCriterionOption}
            filter={filter}
            setFilter={setFilter}
            filterHook={filterHook}
            sectionID="studios"
          />
        )}
        {!hidePerformers && (
          <SidebarPerformersFilter
            title={<FormattedMessage id="performers" />}
            option={PerformersCriterionOption}
            filter={filter}
            setFilter={setFilter}
            filterHook={filterHook}
            sectionID="performers"
          />
        )}
        <SidebarTagsFilter
          title={<FormattedMessage id="tags" />}
          option={TagsCriterionOption}
          filter={filter}
          setFilter={setFilter}
          filterHook={filterHook}
          sectionID="tags"
        />
        <SidebarRatingFilter
          title={<FormattedMessage id="rating" />}
          option={RatingCriterionOption}
          filter={filter}
          setFilter={setFilter}
          sectionID="rating"
        />
      </ImageFilterSidebarSections>
    </Box>
  );
};

interface IImageList {
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  view?: View;
  alterQuery?: boolean;
  extraOperations?: IItemListOperation<GQL.FindImagesQueryResult>[];
  chapters?: GQL.GalleryChapterDataFragment[];
}

const ImageListContent: React.FC<{
  view?: View;
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  otherOperations: IItemListOperation<GQL.FindImagesQueryResult>[];
  addKeybinds: any;
  renderContent: any;
  renderEditDialog: any;
  renderDeleteDialog: any;
  renderMetadataByline: any;
}> = ({
  view,
  filterHook,
  otherOperations,
  addKeybinds,
  renderContent,
  renderEditDialog,
  renderDeleteDialog,
  renderMetadataByline,
}) => {
    const { filter, setFilter: updateFilter } = useFilter();
    const { effectiveFilter, result, metadataInfo, cachedResult, totalCount } =
      useQueryResultContext<GQL.FindImagesQueryResult, GQL.SlimImageDataFragment>();
    const listSelect = useListContext<GQL.SlimImageDataFragment>();

    const {
      showSidebar,
      setShowSidebar,
      sectionOpen,
      setSectionOpen,
      loading: sidebarStateLoading,
    } = useSidebarState(view);

    useFilteredSidebarKeybinds({ showSidebar, setShowSidebar });

    const {
      selectedIds,
      getSelected,
      onSelectChange,
      onSelectAll,
      onSelectNone,
    } = listSelect;

    const { modal, showModal, closeModal } = useModal();

    const { setPage, removeCriterion, clearAllCriteria } = useFilterOperations({
      filter,
      setFilter: updateFilter,
    });

    const showEditFilter = useShowEditFilter({
      showModal,
      closeModal,
      filter,
      setFilter: updateFilter,
    });

    const pages = Math.ceil(totalCount / filter.itemsPerPage);

    const metadataByline = useMemo(() => {
      if (cachedResult.loading) return "";
      return renderMetadataByline?.(cachedResult, metadataInfo) ?? "";
    }, [renderMetadataByline, cachedResult, metadataInfo]);

    const onChangePage = useCallback(
      (p: number) => {
        updateFilter(filter.changePage(p));
      },
      [filter, updateFilter]
    );

    const zoomable =
      filter.displayMode === DisplayMode.Grid ||
      filter.displayMode === DisplayMode.Wall ||
      true;

    const operations = useMemo(() => {
      return otherOperations?.map((o) => ({
        text: o.text,
        onClick: async () => {
          await o.onClick(result, effectiveFilter, selectedIds);
          if (o.postRefetch) result.refetch();
        },
        isDisplayed: () => {
          if (o.isDisplayed) return o.isDisplayed(result, effectiveFilter, selectedIds);
          return true;
        },
        icon: o.icon,
        buttonVariant: o.buttonVariant,
      }));
    }, [result, effectiveFilter, selectedIds, otherOperations]);

    function onEdit() {
      showModal(renderEditDialog(getSelected(), (applied: boolean) => {
        if (applied) onSelectNone();
        closeModal();
        result.refetch();
      }));
    }

    function onDelete() {
      showModal(renderDeleteDialog(getSelected(), (deleted: boolean) => {
        if (deleted) onSelectNone();
        closeModal();
        result.refetch();
      }));
    }

    if (sidebarStateLoading) return null;

    return (
      <SidebarStateContext.Provider value={{ sectionOpen, setSectionOpen }}>
        <Box sx={
          view === View.Images ? {
            position: "relative",
            zIndex: 10,
            mt: { xs: 2, md: "65vh" },
            background: "linear-gradient(to bottom, transparent, #09090b 20%, #09090b)",
            pt: { xs: 4, md: 8 },
            pb: 4,
            px: { xs: 2, md: 6 },
            minHeight: "100vh",
            width: "100vw",
            marginLeft: "calc(50% - 50vw)",
            marginRight: "calc(50% - 50vw)",
            maxWidth: "none",
            "& > *": { maxWidth: "none" },
          } : {
            mt: 4,
            pb: 4,
          }
        }>
          {/* Sticky Header Control Bar */}
          <Box sx={{
            position: "sticky",
            top: 48,
            zIndex: 100,
            backgroundColor: "rgba(0,0,0,0)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
            mx: -2, px: 2, pt: 2, pb: 2, mb: 2,
            transition: "all 0.3s ease",
          }}>
            <FilteredListToolbar
              filter={filter}
              setFilter={updateFilter}
              listSelect={listSelect}
              showEditFilter={showEditFilter}
              view={view}
              operations={operations}
              zoomable={zoomable}
              onEdit={onEdit}
              onDelete={onDelete}
            />

            {totalCount > filter.itemsPerPage && (
              <Box display="flex" justifyContent="center" mt={2}>
                <Box display="flex" flexDirection="column" alignItems="center">
                  <Pagination itemsPerPage={filter.itemsPerPage} currentPage={filter.currentPage} totalItems={totalCount} onChangePage={onChangePage} pagePopupPlacement="bottom" />
                  <Box textAlign="center" mt={1}>
                    <PaginationIndex itemsPerPage={filter.itemsPerPage} currentPage={filter.currentPage} totalItems={totalCount} metadataByline={metadataByline} />
                  </Box>
                </Box>
              </Box>
            )}
          </Box>

          <Box sx={{ display: "flex", alignItems: "flex-start" }}>
            <InlineFilterPanel>
              <SidebarContent
                filter={filter}
                setFilter={updateFilter}
                filterHook={filterHook}
                view={view}
              />
            </InlineFilterPanel>

            <Box sx={{ flex: 1, minWidth: 0, p: 2 }}>
              <FilterTags
                criteria={filter.criteria}
                onEditCriterion={(c) => showEditFilter(c.criterionOption.type)}
                onRemoveCriterion={(c) => updateFilter(filter.removeCriterion(c.criterionOption.type))}
                onRemoveAll={() => updateFilter(filter.clearCriteria())}
              />

              {modal}

              <PagedList
                result={result}
                cachedResult={cachedResult}
                filter={filter}
                totalCount={totalCount}
                onChangePage={onChangePage}
                metadataByline={metadataByline}
                hidePagination={true}
                allowSkeleton={true}
              >
                {renderContent(result, effectiveFilter, selectedIds, onSelectChange, onChangePage, pages)}
              </PagedList>

              {totalCount > filter.itemsPerPage && (
                <Box display="flex" justifyContent="center" mt={4}>
                  <div className="pagination-footer">
                    <Pagination itemsPerPage={filter.itemsPerPage} currentPage={filter.currentPage} totalItems={totalCount} onChangePage={onChangePage} pagePopupPlacement="top" />
                    <Box textAlign="center" mt={1}>
                      <PaginationIndex itemsPerPage={filter.itemsPerPage} currentPage={filter.currentPage} totalItems={totalCount} metadataByline={metadataByline} />
                    </Box>
                  </div>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </SidebarStateContext.Provider>
    );
  }

const EMPTY_IMAGES: GQL.SlimImageDataFragment[] = [];

export const ImageList: React.FC<IImageList> = PatchComponent(
  "ImageList",
  ({ filterHook, view, alterQuery, extraOperations = [], chapters = [] }) => {
    const intl = useIntl();
    const history = useHistory();
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [isExportAll, setIsExportAll] = useState(false);
    const [slideshowRunning, setSlideshowRunning] = useState<boolean>(false);
    const { modal, showModal, closeModal } = useModal();

    async function onExport() {
      setIsExportAll(false);
      setIsExportDialogOpen(true);
    }

    async function onExportAll() {
      setIsExportAll(true);
      setIsExportDialogOpen(true);
    }

    async function viewRandom(
      result: GQL.FindImagesQueryResult,
      filter: ListFilterModel
    ) {
      if (result.data?.findImages) {
        const { count } = result.data.findImages;
        const index = Math.floor(Math.random() * count);
        const filterCopy = cloneDeep(filter);
        filterCopy.itemsPerPage = 1;
        filterCopy.currentPage = index + 1;
        const singleResult = await queryFindImages(filterCopy);
        if (singleResult.data.findImages.images.length === 1) {
          const { id } = singleResult.data.findImages.images[0];
          history.push(`/images/${id}`);
        }
      }
    }

    const otherOperations: IItemListOperation<GQL.FindImagesQueryResult>[] = [
      ...extraOperations,
      {
        text: intl.formatMessage({ id: "actions.view_random" }),
        onClick: viewRandom,
      },
      {
        text: intl.formatMessage({ id: "actions.generate" }),
        onClick: (result, filter, selectedIds) => {
          showModal(
            <GenerateDialog
              type="image"
              selectedIds={Array.from(selectedIds.values())}
              onClose={() => closeModal()}
            />
          );
          return Promise.resolve();
        },
        isDisplayed: showWhenSelected,
      },
      {
        text: intl.formatMessage({ id: "actions.export" }),
        onClick: onExport,
        isDisplayed: showWhenSelected,
      },
      {
        text: intl.formatMessage({ id: "actions.export_all" }),
        onClick: onExportAll,
      },
    ];

    function addKeybinds(
      result: GQL.FindImagesQueryResult,
      filter: ListFilterModel
    ) {
      Mousetrap.bind("p r", () => {
        viewRandom(result, filter);
      });

      return () => {
        Mousetrap.unbind("p r");
      };
    }

    function renderContent(
      result: GQL.FindImagesQueryResult,
      filter: ListFilterModel,
      selectedIds: Set<string>,
      onSelectChange: (
        id: string,
        selected: boolean,
        shiftKey: boolean
      ) => void,
      onChangePage: (page: number) => void,
      pageCount: number
    ) {
      function maybeRenderImageExportDialog() {
        if (isExportDialogOpen) {
          return (
            <ExportDialog
              exportInput={{
                images: {
                  ids: Array.from(selectedIds.values()),
                  all: isExportAll,
                },
              }}
              onClose={() => setIsExportDialogOpen(false)}
            />
          );
        }
      }

      function renderImages() {
        if (!result.data?.findImages && !result.loading) return;

        const images = result.data?.findImages?.images ?? EMPTY_IMAGES;

        return (
          <ImageListImages
            filter={filter}
            images={images}
            onChangePage={onChangePage}
            onSelectChange={onSelectChange}
            pageCount={pageCount}
            selectedIds={selectedIds}
            slideshowRunning={slideshowRunning}
            setSlideshowRunning={setSlideshowRunning}
            chapters={chapters}
            loading={result.loading}
          />
        );
      }

      return (
        <>
          {maybeRenderImageExportDialog()}
          {renderImages()}
        </>
      );
    }

    function renderEditDialog(
      selectedImages: GQL.SlimImageDataFragment[],
      onClose: (applied: boolean) => void
    ) {
      return <EditImagesDialog selected={selectedImages} onClose={onClose} />;
    }

    function renderDeleteDialog(
      selectedImages: GQL.SlimImageDataFragment[],
      onClose: (confirmed: boolean) => void
    ) {
      return <DeleteImagesDialog selected={selectedImages} onClose={onClose} />;
    }

    return (
      <>
        {modal}
        <ItemListContext
          filterMode={GQL.FilterMode.Images}
          useResult={useFindImages}
          useMetadataInfo={useFindImagesMetadata}
          getItems={getItems}
          getCount={getCount}
          alterQuery={alterQuery}
          filterHook={filterHook}
          view={view}
          selectable
        >
          <ImageListContent
            view={view}
            filterHook={filterHook}
            otherOperations={otherOperations}
            addKeybinds={addKeybinds}
            renderContent={renderContent}
            renderEditDialog={renderEditDialog}
            renderDeleteDialog={renderDeleteDialog}
            renderMetadataByline={renderMetadataByline}
          />
        </ItemListContext>
      </>
    );
  }
);
