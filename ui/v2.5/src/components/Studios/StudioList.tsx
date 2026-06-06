import React, { useCallback, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import cloneDeep from "lodash-es/cloneDeep";
import { useHistory, useLocation } from "react-router-dom";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import {
  queryFindStudios,
  useFindStudios,
  useStudiosDestroy,
} from "src/core/StashService";
import { useFilteredItemList } from "../List/ItemList";
import { ListFilterModel } from "src/models/list-filter/filter";
import { DisplayMode } from "src/models/list-filter/types";
import { ExportDialog } from "../Shared/ExportDialog";
import { DeleteStudiosDialog } from "./DeleteStudiosDialog";
import { StudioTagger } from "../Tagger/studios/StudioTagger";
import { SmartStudioCardGrid } from "./VirtualizedStudioCardGrid";
import { View } from "../List/views";
import { EditStudiosDialog } from "./EditStudiosDialog";
import {
  FilteredListToolbar,
  IItemListOperation,
} from "../List/FilteredListToolbar";
import { PatchComponent, PatchContainerComponent } from "src/patch";
import { useCloseEditDelete, useFilterOperations } from "../List/util";
import {
  InlineFilterPanel,
  SidebarStateContext,
  useSidebarState,
} from "../Shared/Sidebar";
import useFocus from "src/utils/focus";
import { useFilteredSidebarKeybinds } from "../List/Filters/FilterSidebar";
import { FilterTags } from "../List/FilterTags";
import { Pagination, PaginationIndex } from "../List/Pagination";
import { LoadedContent } from "../List/PagedList";
import { SidebarTagsFilter } from "../List/Filters/TagsFilter";
import { SidebarRatingFilter } from "../List/Filters/RatingFilter";
import { SidebarBooleanFilter } from "../List/Filters/BooleanFilter";
import { FavoriteStudioCriterionOption } from "src/models/list-filter/criteria/favorite";
import { TagsCriterionOption } from "src/models/list-filter/criteria/tags";
import { RatingCriterionOption } from "src/models/list-filter/criteria/rating";
import { Box, Paper } from "@mui/material";
import cx from "classnames";

const StudioList: React.FC<{
  studios: GQL.StudioDataFragment[];
  filter: ListFilterModel;
  selectedIds: Set<string>;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  fromParent?: boolean;
}> = PatchComponent(
  "StudioList",
  ({ studios, filter, selectedIds, onSelectChange, fromParent }) => {
    if (studios.length === 0 && filter.displayMode !== DisplayMode.Tagger) {
      return null;
    }

    const studioGrid = (
      <SmartStudioCardGrid
        studios={studios}
        zoomIndex={filter.zoomIndex}
        fromParent={fromParent}
        itemsPerPage={filter.itemsPerPage}
        selectedIds={selectedIds}
        onSelectChange={onSelectChange}
        loading={false}
        virtualizationThreshold={50}
      />
    );

    if (filter.displayMode === DisplayMode.Grid) {
      return studioGrid;
    }
    if (filter.displayMode === DisplayMode.List) {
      return studioGrid;
    }
    if (filter.displayMode === DisplayMode.Wall) {
      return studioGrid;
    }
    if (filter.displayMode === DisplayMode.Tagger) {
      return <StudioTagger studios={studios} />;
    }

    return null;
  }
);

const StudioFilterSidebarSections = PatchContainerComponent(
  "FilteredStudioList.SidebarSections"
);

const SidebarContent: React.FC<{
  filter: ListFilterModel;
  setFilter: (filter: ListFilterModel) => void;
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  view?: View;
  showEditFilter: (editingCriterion?: string) => void;
}> = ({
  filter,
  setFilter,
  filterHook,
  view,
  showEditFilter,
}) => {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <StudioFilterSidebarSections>
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
          title={<FormattedMessage id="favourite" />}
          filter={filter}
          setFilter={setFilter}
          option={FavoriteStudioCriterionOption}
          sectionID="favourite"
        />
      </StudioFilterSidebarSections>
    </Box>
  );
};

interface IStudioList {
  fromParent?: boolean;
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  view?: View;
  alterQuery?: boolean;
  extraOperations?: IItemListOperation<GQL.FindStudiosQueryResult>[];
}

function useViewRandom(filter: ListFilterModel, count: number) {
  const history = useHistory();

  const viewRandom = useCallback(async () => {
    // query for a random studio
    if (count === 0) {
      return;
    }

    const index = Math.floor(Math.random() * count);
    const filterCopy = cloneDeep(filter);
    filterCopy.itemsPerPage = 1;
    filterCopy.currentPage = index + 1;
    const singleResult = await queryFindStudios(filterCopy);
    if (singleResult.data.findStudios.studios.length === 1) {
      const { id } = singleResult.data.findStudios.studios[0];
      // navigate to the studio page
      history.push(`/studios/${id}`);
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

export const FilteredStudioList = PatchComponent(
  "FilteredStudioList",
  (props: IStudioList) => {
    const intl = useIntl();
    const history = useHistory();
    const location = useLocation();

    const { filterHook, view, alterQuery, extraOperations = [] } = props;

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
          filterMode: GQL.FilterMode.Studios,
          view,
          useURL: alterQuery,
        },
        queryResultProps: {
          useResult: useFindStudios,
          getCount: (r) => r.data?.findStudios.count ?? 0,
          getItems: (r) => r.data?.findStudios.studios ?? [],
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
      let newPath = "/studios/new";
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
            studios: {
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
        <EditStudiosDialog
          selected={selectedItems}
          onClose={onCloseEditDelete}
        />
      );
    }

    function onDelete() {
      showModal(
        <DeleteStudiosDialog
          selected={selectedItems}
          onClose={onCloseEditDelete}
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

    return (
      <div className="item-list-container studio-list">
        {modal}

        <SidebarStateContext.Provider value={{ sectionOpen, setSectionOpen }}>
          <Paper
            elevation={0}
            sx={{
              bgcolor: "transparent",
            }}
          >
            <Box
              sx={{
                position: "sticky",
                top: 48,
                zIndex: 100,
                px: 2,
                py: 1,
                bgcolor: "transparent",
              }}
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
            </Box>

            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
              <InlineFilterPanel>
                <SidebarContent
                  filter={filter}
                  setFilter={setFilter}
                  filterHook={filterHook}
                  showEditFilter={showEditFilter}
                  view={view}
                />
              </InlineFilterPanel>

              <Box sx={{ flex: 1, minWidth: 0, p: 2 }}>
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
                  <StudioList
                    filter={effectiveFilter}
                    studios={items}
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
              </Box>
            </Box>
          </Paper>
        </SidebarStateContext.Provider>
      </div>
    );
  }
);
