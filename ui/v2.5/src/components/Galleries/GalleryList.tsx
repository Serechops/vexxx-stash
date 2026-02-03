import React, { useCallback, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import cloneDeep from "lodash-es/cloneDeep";
import { useHistory, useLocation } from "react-router-dom";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import { useFilteredItemList } from "../List/ItemList";
import { ListFilterModel } from "src/models/list-filter/filter";
import { DisplayMode } from "src/models/list-filter/types";
import { queryFindGalleries, useFindGalleries } from "src/core/StashService";
import GalleryWallCard from "./GalleryWallCard";
import { EditGalleriesDialog } from "./EditGalleriesDialog";
import { DeleteGalleriesDialog } from "./DeleteGalleriesDialog";
import { ExportDialog } from "../Shared/ExportDialog";
import { GenerateDialog } from "../Dialogs/GenerateDialog";
import { GalleryListTable } from "./GalleryListTable";
import { GalleryCardGrid } from "./GalleryGridCard";
import { View } from "../List/views";
import { PatchComponent } from "src/patch";
import { IItemListOperation } from "../List/FilteredListToolbar";
import { useModal } from "src/hooks/modal";


const GalleryList: React.FC<{
  galleries: GQL.SlimGalleryDataFragment[];
  filter: ListFilterModel;
  selectedIds: Set<string>;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
}> = PatchComponent(
  "GalleryList",
  ({ galleries, filter, selectedIds, onSelectChange }) => {
    if (galleries.length === 0) {
      return null;
    }

    if (filter.displayMode === DisplayMode.Grid) {
      return (
        <GalleryCardGrid
          galleries={galleries}
          selectedIds={selectedIds}
          zoomIndex={filter.zoomIndex}
          onSelectChange={onSelectChange}
        />
      );
    }
    if (filter.displayMode === DisplayMode.List) {
      return (
        <GalleryListTable
          galleries={galleries}
          selectedIds={selectedIds}
          onSelectChange={onSelectChange}
        />
      );
    }
    if (filter.displayMode === DisplayMode.Wall) {
      return (
        <div className={`GalleryWall zoom-${filter.zoomIndex}`}>
          {galleries.map((gallery) => (
            <GalleryWallCard
              key={gallery.id}
              gallery={gallery}
              selected={selectedIds.has(gallery.id)}
              onSelectedChanged={(selected, shiftKey) =>
                onSelectChange(gallery.id, selected, shiftKey)
              }
              selecting={selectedIds.size > 0}
            />
          ))}
        </div>
      );
    }

    return null;
  }
);

const GalleryFilterSidebarSections = PatchContainerComponent(
  "FilteredGalleryList.SidebarSections"
);

const SidebarContent: React.FC<{
  filter: ListFilterModel;
  setFilter: (filter: ListFilterModel) => void;
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  view?: View;
  sidebarOpen: boolean;
  onClose?: () => void;
  showEditFilter: (editingCriterion?: string) => void;
  count?: number;
  focus?: ReturnType<typeof useFocus>;
}> = ({
  filter,
  setFilter,
  filterHook,
  view,
  showEditFilter,
  sidebarOpen,
  onClose,
  count,
  focus,
}) => {
  const showResultsId =
    count !== undefined ? "actions.show_count_results" : "actions.show_results";

  const hideStudios = view === View.StudioGalleries;

  return (
    <>
      <FilteredSidebarHeader
        sidebarOpen={sidebarOpen}
        showEditFilter={showEditFilter}
        filter={filter}
        setFilter={setFilter}
        view={view}
        focus={focus}
      />

      <GalleryFilterSidebarSections>
        {!hideStudios && (
          <SidebarStudiosFilter
            title={<FormattedMessage id="studios" />}
            data-type={StudiosCriterionOption.type}
            option={StudiosCriterionOption}
            filter={filter}
            setFilter={setFilter}
            filterHook={filterHook}
            sectionID="studios"
          />
        )}
        <SidebarPerformersFilter
          title={<FormattedMessage id="performers" />}
          data-type={PerformersCriterionOption.type}
          option={PerformersCriterionOption}
          filter={filter}
          setFilter={setFilter}
          filterHook={filterHook}
          sectionID="performers"
        />
        <SidebarTagsFilter
          title={<FormattedMessage id="tags" />}
          data-type={TagsCriterionOption.type}
          option={TagsCriterionOption}
          filter={filter}
          setFilter={setFilter}
          filterHook={filterHook}
          sectionID="tags"
        />
        <SidebarRatingFilter
          title={<FormattedMessage id="rating" />}
          data-type={RatingCriterionOption.type}
          option={RatingCriterionOption}
          filter={filter}
          setFilter={setFilter}
          sectionID="rating"
        />
        <SidebarBooleanFilter
          title={<FormattedMessage id="organized" />}
          data-type={OrganizedCriterionOption.type}
          option={OrganizedCriterionOption}
          filter={filter}
          setFilter={setFilter}
          sectionID="organized"
        />
      </GalleryFilterSidebarSections>

      <div className="sidebar-footer">
        <Button className="sidebar-close-button" onClick={onClose}>
          <FormattedMessage id={showResultsId} values={{ count }} />
        </Button>
      </div>
    </>
  );
};

interface IGalleryList {
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  view?: View;
  alterQuery?: boolean;
  extraOperations?: IItemListOperation<GQL.FindGalleriesQueryResult>[];
}

function useViewRandom(filter: ListFilterModel, count: number) {
  const history = useHistory();

  const viewRandom = useCallback(async () => {
    // query for a random gallery
    if (count === 0) {
      return;
    }

    const index = Math.floor(Math.random() * count);
    const filterCopy = cloneDeep(filter);
    filterCopy.itemsPerPage = 1;
    filterCopy.currentPage = index + 1;
    const singleResult = await queryFindGalleries(filterCopy);
    if (singleResult.data.findGalleries.galleries.length === 1) {
      const { id } = singleResult.data.findGalleries.galleries[0];
      // navigate to the gallery page
      history.push(`/galleries/${id}`);
    }
  }, [history, filter, count]);

  return viewRandom;
}

function useAddKeybinds(filter: ListFilterModel, count: number) {
  const viewRandom = useViewRandom(filter, count);

  useEffect(() => {
    Mousetrap.bind("p r", () => {
      viewRandom();
    });

    return () => {
      Mousetrap.unbind("p r");
    };
  }, [viewRandom]);
}

export const FilteredGalleryList = PatchComponent(
  "FilteredGalleryList",
  (props: IGalleryList) => {
    const intl = useIntl();
    const history = useHistory();
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [isExportAll, setIsExportAll] = useState(false);
    const { modal, showModal, closeModal } = useModal();

    const searchFocus = useFocus();

    const {
      filterHook,
      view,
      alterQuery,
      extraOperations = [],
    } = props;

    // States
    const {
      showSidebar,
      setShowSidebar,
      sectionOpen,
      setSectionOpen,
      loading: sidebarStateLoading,
    } = useSidebarState(view);

    const { filterState, queryResult, modalState, listSelect, showEditFilter } =
      useFilteredItemList({
        filterStateProps: {
          filterMode: GQL.FilterMode.Galleries,
          view,
          useURL: alterQuery,
        },
        queryResultProps: {
          useResult: useFindGalleries,
          getCount: (r) => r.data?.findGalleries.count ?? 0,
          getItems: (r) => r.data?.findGalleries.galleries ?? [],
          filterHook,
        },
      });

    const { filter, setFilter } = filterState;

    const { effectiveFilter, result, cachedResult, items, totalCount } =
      queryResult;

    const {
      selectedIds,
      selectedItems,
      onSelectChange,
      onSelectAll,
      onSelectNone,
      onInvertSelection,
      hasSelection,
    } = listSelect;

    const { modal, showModal, closeModal } = modalState;

    // Utility hooks
    const { setPage, removeCriterion, clearAllCriteria } = useFilterOperations({
      filter,
      setFilter,
    });

    useAddKeybinds(filter, totalCount);
    useFilteredSidebarKeybinds({
      showSidebar,
      setShowSidebar,
    });

    useEffect(() => {
      Mousetrap.bind("e", () => {
        if (hasSelection) {
          onEdit?.();
        }
      });

      Mousetrap.bind("d d", () => {
        if (hasSelection) {
          onDelete?.();
        }
      });

      return () => {
        Mousetrap.unbind("e");
        Mousetrap.unbind("d d");
      };
    });

    const onCloseEditDelete = useCloseEditDelete({
      closeModal,
      onSelectNone,
      result,
    });

    function onCreateNew() {
      let queryParam = new URLSearchParams(location.search).get("q");
      let newPath = "/galleries/new";
      if (queryParam) {
        newPath += "?q=" + encodeURIComponent(queryParam);
      }
      history.push(newPath);
    }

    const viewRandom = useViewRandom(filter, totalCount);

    function onExport(all: boolean) {
      showModal(
        <ExportDialog
          exportInput={{
            galleries: {
              ids: Array.from(selectedIds.values()),
              all: all,
            },
          }}
          onClose={() => closeModal()}
        />
      );
    }

    function onEdit() {
      showModal(
        <EditGalleriesDialog
          selected={selectedItems}
          onClose={onCloseEditDelete}
        />
      );
    }

    function onDelete() {
      showModal(
        <DeleteGalleriesDialog
          selected={selectedItems}
          onClose={onCloseEditDelete}
        />
      );
    }

    function onGenerate() {
      showModal(
        <GenerateDialog
          type="gallery"
          selectedIds={Array.from(selectedIds.values())}
          onClose={() => closeModal()}
        />
      );
    }

    const convertedExtraOperations = extraOperations.map((op) => ({
      text: op.text,
      onClick: () => op.onClick(result, filter, selectedIds),
      isDisplayed: () => op.isDisplayed?.(result, filter, selectedIds) ?? true,
    }));

    const otherOperations = [
      ...convertedExtraOperations,
      {
        text: intl.formatMessage({ id: "actions.select_all" }),
        onClick: () => onSelectAll(),
        isDisplayed: () => totalCount > 0,
      },
      {
        text: intl.formatMessage({ id: "actions.select_none" }),
        onClick: () => onSelectNone(),
        isDisplayed: () => hasSelection,
      },
      {
        text: intl.formatMessage({ id: "actions.invert_selection" }),
        onClick: () => onInvertSelection(),
        isDisplayed: () => totalCount > 0,
      },
      {
        text: intl.formatMessage({ id: "actions.view_random" }),
        onClick: viewRandom,
      },
      {
        text: `${intl.formatMessage({ id: "actions.generate" })}…`,
        onClick: (
          _result: GQL.FindGalleriesQueryResult,
          _filter: ListFilterModel,
          selectedIds: Set<string>
        ) => {
          showModal(
            <GenerateDialog
              type="gallery"
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
        onClick: () => onExport(false),
        isDisplayed: () => hasSelection,
      },
      {
        text: intl.formatMessage({ id: "actions.export_all" }),
        onClick: () => onExport(true),
      },
    ];

    // render
    if (sidebarStateLoading) return null;

      return () => {
        Mousetrap.unbind("p r");
      };
    }

    async function viewRandom(
      result: GQL.FindGalleriesQueryResult,
      filter: ListFilterModel
    ) {
      // query for a random image
      if (result.data?.findGalleries) {
        const { count } = result.data.findGalleries;

        const index = Math.floor(Math.random() * count);
        const filterCopy = cloneDeep(filter);
        filterCopy.itemsPerPage = 1;
        filterCopy.currentPage = index + 1;
        const singleResult = await queryFindGalleries(filterCopy);
        if (singleResult.data.findGalleries.galleries.length === 1) {
          const { id } = singleResult.data.findGalleries.galleries[0];
          // navigate to the image player page
          history.push(`/galleries/${id}`);
        }
      }
    }

    async function onExport() {
      setIsExportAll(false);
      setIsExportDialogOpen(true);
    }

    async function onExportAll() {
      setIsExportAll(true);
      setIsExportDialogOpen(true);
    }

    function renderContent(
      result: GQL.FindGalleriesQueryResult,
      filter: ListFilterModel,
      selectedIds: Set<string>,
      onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void
    ) {
      function maybeRenderGalleryExportDialog() {
        if (isExportDialogOpen) {
          return (
            <ExportDialog
              exportInput={{
                galleries: {
                  ids: Array.from(selectedIds.values()),
                  all: isExportAll,
                },
              }}
              onClose={() => setIsExportDialogOpen(false)}
            />
          );
        }
      }

      function renderGalleries() {
        if (!result.data?.findGalleries) return;

        if (filter.displayMode === DisplayMode.Grid) {
          return (
            <GalleryCardGrid
              galleries={result.data.findGalleries.galleries}
              selectedIds={selectedIds}
              zoomIndex={filter.zoomIndex}
              onSelectChange={onSelectChange}
            />
          );
        }
        if (filter.displayMode === DisplayMode.List) {
          return (
            <GalleryListTable
              galleries={result.data.findGalleries.galleries}
              selectedIds={selectedIds}
              onSelectChange={onSelectChange}
            />
          );
        }
        if (filter.displayMode === DisplayMode.Wall) {
          return (
            <div className="row">
              <div className={`GalleryWall zoom-${filter.zoomIndex}`}>
                {result.data.findGalleries.galleries.map((gallery) => (
                  <GalleryWallCard
                    key={gallery.id}
                    gallery={gallery}
                    selected={selectedIds.has(gallery.id)}
                    onSelectedChanged={(selected, shiftKey) =>
                      onSelectChange(gallery.id, selected, shiftKey)
                    }
                    selecting={selectedIds.size > 0}
                  />
                ))}
              </div>
            </div>
          );
        }
      }

      return (
        <>
          {maybeRenderGalleryExportDialog()}
          {modal}
          {renderGalleries()}
        </>
      );
    }

    function renderEditDialog(
      selectedImages: GQL.SlimGalleryDataFragment[],
      onClose: (applied: boolean) => void
    ) {
      return (
        <EditGalleriesDialog selected={selectedImages} onClose={onClose} />
      );
    }

    function renderDeleteDialog(
      selectedImages: GQL.SlimGalleryDataFragment[],
      onClose: (confirmed: boolean) => void
    ) {
      return (
        <DeleteGalleriesDialog selected={selectedImages} onClose={onClose} />
      );
    }

    return (
      <ItemListContext
        filterMode={filterMode}
        useResult={useFindGalleries}
        getItems={getItems}
        getCount={getCount}
        alterQuery={alterQuery}
        filterHook={filterHook}
        view={view}
        selectable
      >
        {modal}

        <SidebarStateContext.Provider value={{ sectionOpen, setSectionOpen }}>
          <SidebarPane hideSidebar={!showSidebar}>
            <Sidebar hide={!showSidebar} onHide={() => setShowSidebar(false)}>
              <SidebarContent
                filter={filter}
                setFilter={setFilter}
                filterHook={filterHook}
                showEditFilter={showEditFilter}
                view={view}
                sidebarOpen={showSidebar}
                onClose={() => setShowSidebar(false)}
                count={cachedResult.loading ? undefined : totalCount}
                focus={searchFocus}
              />
            </Sidebar>
            <SidebarPaneContent
              onSidebarToggle={() => setShowSidebar(!showSidebar)}
            >
              <FilteredListToolbar
                filter={filter}
                listSelect={listSelect}
                setFilter={setFilter}
                showEditFilter={showEditFilter}
                onDelete={onDelete}
                onEdit={onEdit}
                operations={otherOperations}
                view={view}
                zoomable
              />

              <FilterTags
                criteria={filter.criteria}
                onEditCriterion={(c) => showEditFilter(c.criterionOption.type)}
                onRemoveCriterion={removeCriterion}
                onRemoveAll={clearAllCriteria}
              />

              <div className="pagination-index-container">
                <Pagination
                  currentPage={filter.currentPage}
                  itemsPerPage={filter.itemsPerPage}
                  totalItems={totalCount}
                  onChangePage={(page) => setFilter(filter.changePage(page))}
                />
                <PaginationIndex
                  loading={cachedResult.loading}
                  itemsPerPage={filter.itemsPerPage}
                  currentPage={filter.currentPage}
                  totalItems={totalCount}
                />
              </div>

              <LoadedContent loading={result.loading} error={result.error}>
                <GalleryList
                  filter={effectiveFilter}
                  galleries={items}
                  selectedIds={selectedIds}
                  onSelectChange={onSelectChange}
                />
              </LoadedContent>

              {totalCount > filter.itemsPerPage && (
                <div className="pagination-footer-container">
                  <div className="pagination-footer">
                    <Pagination
                      itemsPerPage={filter.itemsPerPage}
                      currentPage={filter.currentPage}
                      totalItems={totalCount}
                      onChangePage={setPage}
                      pagePopupPlacement="top"
                    />
                  </div>
                </div>
              )}
            </SidebarPaneContent>
          </SidebarPane>
        </SidebarStateContext.Provider>
      </div>
    );

    // Wrap with Box for hero positioning when on main Galleries page
    if (view === View.Galleries) {
      return (
        <Box
          sx={{
            position: "relative",
            zIndex: 10,
            mt: { xs: 4, md: "65vh" },
            background: (theme) =>
              `linear-gradient(to bottom, transparent, ${theme.palette.background.default} 20%, ${theme.palette.background.default})`,
            minHeight: "100vh",
            transition: "margin-top 0.3s ease",
          }}
        >
          {content}
        </Box>
      );
    }

    return content;
  }
);
