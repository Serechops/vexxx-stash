import React, { useCallback, useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import cloneDeep from "lodash-es/cloneDeep";
import { useHistory, useLocation } from "react-router-dom";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import {
  queryFindTagsForList,
  useFindTagsForList,
} from "src/core/StashService";
import { useFilteredItemList } from "../List/ItemList";
import { ListFilterModel } from "src/models/list-filter/filter";
import { DisplayMode } from "src/models/list-filter/types";
import { ExportDialog } from "../Shared/ExportDialog";
import { SmartTagCardGrid } from "./VirtualizedTagCardGrid";
import { DeleteTagDialog } from "./DeleteTagDialog";
import { View } from "../List/views";
import { EditTagsDialog } from "./EditTagsDialog";
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
import { SidebarPerformersFilter } from "../List/Filters/PerformersFilter";
import { PerformersCriterionOption } from "src/models/list-filter/criteria/performers";
import { Box, Button, Paper } from "@mui/material";
import { TagMergeModal } from "./TagMergeDialog";
import { Tag } from "./TagSelect";
import { TagListTable } from "./TagListTable";
import { useToast } from "src/hooks/Toast";
import cx from "classnames";

const TagList: React.FC<{
  tags: GQL.TagListDataFragment[];
  filter: ListFilterModel;
  selectedIds: Set<string>;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
}> = PatchComponent(
  "TagList",
  ({ tags, filter, selectedIds, onSelectChange }) => {

    if (tags.length === 0) {
      return null;
    }

    const tagGrid = (
      <SmartTagCardGrid
        tags={tags}
        zoomIndex={filter.zoomIndex}
        itemsPerPage={filter.itemsPerPage}
        selectedIds={selectedIds}
        onSelectChange={onSelectChange}
        loading={false}
        virtualizationThreshold={50}
      />
    );

    if (filter.displayMode === DisplayMode.Grid) {
      return tagGrid;
    }
    if (filter.displayMode === DisplayMode.List) {
      return (
        <TagListTable
          tags={tags}
          selectedIds={selectedIds}
          onSelectChange={onSelectChange}
        />
      );
    }
    if (filter.displayMode === DisplayMode.Wall) {
      return tagGrid;
    }

    return null;
  }
);

const TagFilterSidebarSections = PatchContainerComponent(
  "FilteredTagList.SidebarSections"
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
      <TagFilterSidebarSections>
        <SidebarPerformersFilter
          title={<FormattedMessage id="performers" />}
          data-type={PerformersCriterionOption.type}
          option={PerformersCriterionOption}
          filter={filter}
          setFilter={setFilter}
          filterHook={filterHook}
          sectionID="performers"
        />
      </TagFilterSidebarSections>
    </Box>
  );
};

interface ITagList {
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  view?: View;
  alterQuery?: boolean;
  extraOperations?: IItemListOperation<GQL.FindTagsForListQueryResult>[];
}

function useViewRandom(filter: ListFilterModel, count: number) {
  const history = useHistory();

  const viewRandom = useCallback(async () => {
    // query for a random tag
    if (count === 0) {
      return;
    }

    const index = Math.floor(Math.random() * count);
    const filterCopy = cloneDeep(filter);
    filterCopy.itemsPerPage = 1;
    filterCopy.currentPage = index + 1;
    const singleResult = await queryFindTagsForList(filterCopy);
    if (singleResult.data.findTags.tags.length === 1) {
      const { id } = singleResult.data.findTags.tags[0];
      // navigate to the tag page
      history.push(`/tags/${id}`);
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

export const FilteredTagList = PatchComponent(
  "FilteredTagList",
  (props: ITagList) => {
    const intl = useIntl();
    const history = useHistory();
    const location = useLocation();
    const Toast = useToast();

    const { filterHook, view, alterQuery, extraOperations = [] } = props;

    // States
    const {
      showSidebar,
      setShowSidebar,
      sectionOpen,
      setSectionOpen,
      loading: sidebarStateLoading,
    } = useSidebarState(view);

    const [mergeTags, setMergeTags] = useState<Tag[] | undefined>(undefined);
    const [deletingTags, setDeletingTags] =
      useState<GQL.TagListDataFragment[] | null>(null);

    const { filterState, queryResult, modalState, listSelect, showEditFilter } =
      useFilteredItemList({
        filterStateProps: {
          filterMode: GQL.FilterMode.Tags,
          view,
          useURL: alterQuery,
        },
        queryResultProps: {
          useResult: useFindTagsForList,
          getCount: (r) => r.data?.findTags.count ?? 0,
          getItems: (r) => r.data?.findTags.tags ?? [],
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

    const onCloseEditDelete = useCloseEditDelete({
      closeModal,
      onSelectNone,
      result,
    });

    function onCreateNew() {
      let queryParam = new URLSearchParams(location.search).get("q");
      if (queryParam === null) {
        queryParam = "";
      }
      history.push(`/tags/new?q=${queryParam}`);
    }

    const onEdit = () => {
      showModal(<EditTagsDialog selected={selectedItems} onClose={onCloseEditDelete} />);
    };

    const onDelete = () => {
      showModal(
        <DeleteTagDialog
          selected={selectedItems}
          onClose={onCloseEditDelete}
        />
      );
    };

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



    const onExport = (isAll: boolean) => {
      showModal(
        <ExportDialog
          exportInput={{
            tags: {
              ids: isAll ? [] : Array.from(selectedIds.values()),
              all: isAll,
            },
          }}
          onClose={closeModal}
        />
      );
    };

    async function onMerge() {
      setMergeTags(selectedItems);
    }

    const viewRandom = useViewRandom(filter, totalCount);

    const convertedExtraOperations = extraOperations.map((o) => ({
      text: o.text,
      onClick: () => o.onClick(result, filter, selectedIds),
      isDisplayed: () => o.isDisplayed?.(result, filter, selectedIds) ?? true,
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
        text: intl.formatMessage({ id: "new_tag" }),
        onClick: onCreateNew,
      },
      {
        text: intl.formatMessage({ id: "actions.view_random" }),
        onClick: viewRandom,
      },
      {
        text: `${intl.formatMessage({ id: "actions.merge" })}…`,
        onClick: onMerge,
        isDisplayed: () => hasSelection,
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
      <div className="item-list-container tag-list">
        {modal}

        {mergeTags && (
          <TagMergeModal
            tags={mergeTags}
            onClose={(mergedId?: string) => {
              setMergeTags(undefined);
              if (mergedId) {
                history.push(`/tags/${mergedId}`);
              }
            }}
            show
          />
        )}

        {deletingTags && (
          <DeleteTagDialog
            selected={deletingTags}
            onClose={() => setDeletingTags(null)}
          />
        )}

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
                <TagList
                  filter={effectiveFilter}
                  tags={items}
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
