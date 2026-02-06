import React, { useCallback, useEffect, useState } from "react";
import { FormattedMessage, FormattedNumber, useIntl } from "react-intl";
import cloneDeep from "lodash-es/cloneDeep";
import { useHistory, useLocation } from "react-router-dom";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import {
  queryFindTagsForList,
  useFindTagsForList,
  useTagsDestroy,
  mutateMetadataAutoTag,
} from "src/core/StashService";
import { useFilteredItemList } from "../List/ItemList";
import { ListFilterModel } from "src/models/list-filter/filter";
import { DisplayMode } from "src/models/list-filter/types";
import { ExportDialog } from "../Shared/ExportDialog";
import { DeleteEntityDialog } from "../Shared/DeleteEntityDialog";
import { SmartTagCardGrid } from "./VirtualizedTagCardGrid";
import { View } from "../List/views";
import { EditTagsDialog } from "./EditTagsDialog";
import {
  FilteredListToolbar,
  IItemListOperation,
} from "../List/FilteredListToolbar";
import { PatchComponent, PatchContainerComponent } from "src/patch";
import { useCloseEditDelete, useFilterOperations } from "../List/util";
import {
  Sidebar,
  SidebarPane,
  SidebarPaneContent,
  SidebarStateContext,
  useSidebarState,
} from "../Shared/Sidebar";
import useFocus from "src/utils/focus";
import {
  FilteredSidebarHeader,
  useFilteredSidebarKeybinds,
} from "../List/Filters/FilterSidebar";
import { FilterTags } from "../List/FilterTags";
import { Pagination, PaginationIndex } from "../List/Pagination";
import { LoadedContent } from "../List/PagedList";
import { SidebarPerformersFilter } from "../List/Filters/PerformersFilter";
import { PerformersCriterionOption } from "src/models/list-filter/criteria/performers";
import { Button, IconButton, Box, Grid, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import { TagMergeModal } from "./TagMergeDialog";
import { Tag } from "./TagSelect";
import NavUtils from "src/utils/navigation";
import DeleteIcon from "@mui/icons-material/Delete";
import { ModalComponent } from "../Shared/Modal";
import { useToast } from "src/hooks/Toast";
import { tagRelationHook } from "../../core/tags";
import { useTagDestroy } from "src/core/StashService";
import cx from "classnames";

const TagList: React.FC<{
  tags: GQL.TagListDataFragment[];
  filter: ListFilterModel;
  selectedIds: Set<string>;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  onDelete: (tag: GQL.TagListDataFragment) => void;
  onAutoTag: (tag: GQL.TagListDataFragment) => void;
}> = PatchComponent(
  "TagList",
  ({ tags, filter, selectedIds, onSelectChange, onDelete, onAutoTag }) => {
    const intl = useIntl();

    if (tags.length === 0) {
      return null;
    }

    if (filter.displayMode === DisplayMode.Grid) {
      return (
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
    }
    if (filter.displayMode === DisplayMode.List) {
      const tagElements = tags.map((tag) => {
        return (
          <Grid
            container
            key={tag.id}
            className="tag-list-row"
            alignItems="center"
            sx={{ py: 1.25, borderBottom: "1px solid rgba(255, 255, 255, 0.12)" }}
          >
            <Grid sx={{ flexGrow: 1, pl: 2 }}>
              <Link
                to={`/tags/${tag.id}`}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                <Typography variant="body1">{tag.name}</Typography>
              </Link>
            </Grid>

            <Grid sx={{ display: "flex", gap: 1, pr: 2 }}>
              <Button
                variant="contained"
                color="secondary"
                className="tag-list-button"
                onClick={() => onAutoTag(tag)}
                size="small"
              >
                <FormattedMessage id="actions.auto_tag" />
              </Button>
              <Button
                variant="contained"
                color="secondary"
                className="tag-list-button"
                size="small"
              >
                <Link
                  to={NavUtils.makeTagScenesUrl(tag)}
                  className="tag-list-anchor"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <FormattedMessage
                    id="countables.scenes"
                    values={{
                      count: tag.scene_count ?? 0,
                    }}
                  />
                  : <FormattedNumber value={tag.scene_count ?? 0} />
                </Link>
              </Button>
              <Button
                variant="contained"
                color="secondary"
                className="tag-list-button"
                size="small"
              >
                <Link
                  to={NavUtils.makeTagImagesUrl(tag)}
                  className="tag-list-anchor"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <FormattedMessage
                    id="countables.images"
                    values={{
                      count: tag.image_count ?? 0,
                    }}
                  />
                  : <FormattedNumber value={tag.image_count ?? 0} />
                </Link>
              </Button>
              <Button
                variant="contained"
                color="secondary"
                className="tag-list-button"
                size="small"
              >
                <Link
                  to={NavUtils.makeTagGalleriesUrl(tag)}
                  className="tag-list-anchor"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <FormattedMessage
                    id="countables.galleries"
                    values={{
                      count: tag.gallery_count ?? 0,
                    }}
                  />
                  : <FormattedNumber value={tag.gallery_count ?? 0} />
                </Link>
              </Button>
              <Button
                variant="contained"
                color="secondary"
                className="tag-list-button"
                size="small"
              >
                <Link
                  to={NavUtils.makeTagSceneMarkersUrl(tag)}
                  className="tag-list-anchor"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <FormattedMessage
                    id="countables.markers"
                    values={{
                      count: tag.scene_marker_count ?? 0,
                    }}
                  />
                  : <FormattedNumber value={tag.scene_marker_count ?? 0} />
                </Link>
              </Button>
              <Box
                className="tag-list-count"
                sx={{ display: "flex", alignItems: "center", mx: 1 }}
              >
                <FormattedMessage id="total" />:{" "}
                <FormattedNumber
                  value={
                    (tag.scene_count || 0) +
                    (tag.scene_marker_count || 0) +
                    (tag.image_count || 0) +
                    (tag.gallery_count || 0)
                  }
                />
              </Box>
              <IconButton color="error" onClick={() => onDelete(tag)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Grid>
          </Grid>
        );
      });

      return (
        <Grid container justifyContent="center">
          <Grid size={{ xs: 12, sm: 8 }}>{tagElements}</Grid>
        </Grid>
      );
    }
    if (filter.displayMode === DisplayMode.Wall) {
      return <h1>TODO</h1>;
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

      <div className="sidebar-footer">
        <Button className="sidebar-close-button" onClick={onClose}>
          <FormattedMessage id={showResultsId} values={{ count }} />
        </Button>
      </div>
    </>
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

    const searchFocus = useFocus();

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
    const [deletingTag, setDeletingTag] =
      useState<GQL.TagListDataFragment | null>(null);

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

    const [deleteTag] = useTagDestroy();

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
        <DeleteEntityDialog
          selected={selectedItems}
          onClose={onCloseEditDelete}
          singularEntity={intl.formatMessage({ id: "tag" })}
          pluralEntity={intl.formatMessage({ id: "tags" })}
          destroyMutation={useTagsDestroy}
          onDeleted={() => {
            selectedItems.forEach((t) =>
              tagRelationHook(
                t,
                { parents: t.parents ?? [], children: t.children ?? [] },
                { parents: [], children: [] }
              )
            );
          }}
        />
      );
    };

    async function onAutoTag(tag: GQL.TagListDataFragment) {
      if (!tag) return;
      try {
        await mutateMetadataAutoTag({ tags: [tag.id] });
        Toast.success(intl.formatMessage({ id: "Started Auto-Tagging..." }));
      } catch (e) {
        Toast.error(e);
      }
    }

    async function onDeleteSingle() {
      if (!deletingTag) return;
      try {
        const oldRelations = {
          parents: deletingTag.parents ?? [],
          children: deletingTag.children ?? [],
        };
        await deleteTag({ variables: { input: { id: deletingTag.id } } });
        tagRelationHook(deletingTag, oldRelations, {
          parents: [],
          children: [],
        });
        Toast.success(
          intl.formatMessage(
            { id: "toast.delete_past_tense" },
            {
              count: 1,
              singularEntity: intl.formatMessage({ id: "tag" }),
              pluralEntity: intl.formatMessage({ id: "tags" }),
            }
          )
        );
        setDeletingTag(null);
      } catch (e) {
        Toast.error(e);
      }
    }

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

    const convertedExtraOperations = extraOperations.map((o) => {
      return {
        text: o.text,
        onClick: () => {
          const queryResult = {
            data: {
              findTags: {
                tags: items,
                count: totalCount,
              },
            },
            loading: result.loading,
          };
          o.onClick(queryResult, filter, selectedIds);
        },
        isDisplayed: o.isDisplayed
          ? () => {
              const queryResult = {
                data: {
                  findTags: {
                    tags: items,
                    count: totalCount,
                  },
                },
                loading: result.loading,
              };
              return o.isDisplayed(queryResult, filter, selectedIds);
            }
          : undefined,
      };
    });

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
      <div
        className={cx("item-list-container tag-list", {
          "hide-sidebar": !showSidebar,
        })}
      >
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

        {deletingTag && (
          <ModalComponent
            onHide={() => setDeletingTag(null)}
            show={true}
            icon={<DeleteIcon />}
            accept={{
              onClick: onDeleteSingle,
              variant: "danger",
              text: intl.formatMessage({ id: "actions.delete" }),
            }}
            cancel={{ onClick: () => setDeletingTag(null) }}
          >
            <span>
              <FormattedMessage
                id="dialogs.delete_confirm"
                values={{ entityName: deletingTag.name }}
              />
            </span>
          </ModalComponent>
        )}

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
                onCreate={onCreateNew}
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
                <TagList
                  filter={effectiveFilter}
                  tags={items}
                  selectedIds={selectedIds}
                  onSelectChange={onSelectChange}
                  onDelete={(tag) => setDeletingTag(tag)}
                  onAutoTag={onAutoTag}
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
  }
);
