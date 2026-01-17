import React, { PropsWithChildren, useState, useMemo, useCallback } from "react";
import { useIntl } from "react-intl";
import cloneDeep from "lodash-es/cloneDeep";
import Mousetrap from "mousetrap";
import { useHistory } from "react-router-dom";
import { ListFilterModel } from "src/models/list-filter/filter";
import { DisplayMode } from "src/models/list-filter/types";
import * as GQL from "src/core/generated-graphql";
import {
  queryFindGroups,
  useFindGroups,
  useGroupsDestroy,
} from "src/core/StashService";
import { ItemListContext, showWhenSelected } from "../List/ItemList";
import { ExportDialog } from "../Shared/ExportDialog";
import { DeleteEntityDialog } from "../Shared/DeleteEntityDialog";
import { GroupCardGrid } from "./GroupCardGrid";
import { EditGroupsDialog } from "./EditGroupsDialog";
import { View } from "../List/views";
import {
  IFilteredListToolbar,
  IItemListOperation,
  FilteredListToolbar,
} from "../List/FilteredListToolbar";
import { PatchComponent } from "src/patch";
import { useFilterOperations } from "../List/util";
import { useFilter } from "../List/FilterProvider";
import { useListContext, useQueryResultContext } from "../List/ListProvider";
import { useModal } from "src/hooks/modal";
import { Box } from "@mui/material";
import { Pagination, PaginationIndex } from "../List/Pagination";
import { FilterTags } from "../List/FilterTags";
import { PagedList } from "../List/PagedList";
import { useShowEditFilter } from "src/components/List/EditFilterDialog";

const GroupExportDialog: React.FC<{
  open?: boolean;
  selectedIds: Set<string>;
  isExportAll?: boolean;
  onClose: () => void;
}> = ({ open = false, selectedIds, isExportAll = false, onClose }) => {
  if (!open) {
    return null;
  }

  return (
    <ExportDialog
      exportInput={{
        groups: {
          ids: Array.from(selectedIds.values()),
          all: isExportAll,
        },
      }}
      onClose={onClose}
    />
  );
};

const filterMode = GQL.FilterMode.Groups;

function getItems(result: GQL.FindGroupsQueryResult) {
  return result?.data?.findGroups?.groups ?? [];
}

function getCount(result: GQL.FindGroupsQueryResult) {
  return result?.data?.findGroups?.count ?? 0;
}

interface IGroupListContext {
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  defaultFilter?: ListFilterModel;
  view?: View;
  alterQuery?: boolean;
  selectable?: boolean;
}

export const GroupListContext: React.FC<
  PropsWithChildren<IGroupListContext>
> = ({ alterQuery, filterHook, defaultFilter, view, selectable, children }) => {
  return (
    <ItemListContext
      filterMode={filterMode}
      defaultFilter={defaultFilter}
      useResult={useFindGroups}
      getItems={getItems}
      getCount={getCount}
      alterQuery={alterQuery}
      filterHook={filterHook}
      view={view}
      selectable={selectable}
    >
      {children}
    </ItemListContext>
  );
};

interface IGroupList extends IGroupListContext {
  fromGroupId?: string;
  onMove?: (srcIds: string[], targetId: string, after: boolean) => void;
  renderToolbar?: (props: IFilteredListToolbar) => React.ReactNode;
  otherOperations?: IItemListOperation<GQL.FindGroupsQueryResult>[];
}

const GroupListContent: React.FC<{
  view?: View;
  otherOperations: IItemListOperation<GQL.FindGroupsQueryResult>[];
  addKeybinds: any;
  renderContent: any;
  renderEditDialog: any;
  renderDeleteDialog: any;
  renderToolbar?: (props: IFilteredListToolbar) => React.ReactNode;
}> = ({
  view,
  otherOperations,
  addKeybinds,
  renderContent,
  renderEditDialog,
  renderDeleteDialog,
  renderToolbar,
}) => {
    const { filter, setFilter: updateFilter } = useFilter();
    const { effectiveFilter, result, metadataInfo, cachedResult, totalCount } =
      useQueryResultContext<GQL.FindGroupsQueryResult, GQL.SlimGroupDataFragment>();
    const listSelect = useListContext<GQL.SlimGroupDataFragment>();

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

    const onChangePage = useCallback(
      (p: number) => {
        updateFilter(filter.changePage(p));
      },
      [filter, updateFilter]
    );

    const zoomable = filter.displayMode === DisplayMode.Grid;

    const operations = useMemo(() => {
      return otherOperations?.map((o) => ({
        text: o.text,
        onClick: async () => {
          await o.onClick(result, effectiveFilter, selectedIds);
          if (o.postRefetch) result.refetch();
        },
        isDisplayed: () => {
          if (o.isDisplayed)
            return o.isDisplayed(result, effectiveFilter, selectedIds);
          return true;
        },
        icon: o.icon,
        buttonVariant: o.buttonVariant,
      }));
    }, [result, effectiveFilter, selectedIds, otherOperations]);

    function onEdit() {
      showModal(
        renderEditDialog(getSelected(), (applied: boolean) => {
          if (applied) onSelectNone();
          closeModal();
          result.refetch();
        })
      );
    }

    function onDelete() {
      showModal(
        renderDeleteDialog(getSelected(), (deleted: boolean) => {
          if (deleted) onSelectNone();
          closeModal();
          result.refetch();
        })
      );
    }

    return (
      <Box
        sx={
          view === View.Groups ? {
            position: "relative",
            zIndex: 10,
            mt: { xs: 4, md: '65vh' },
            background: (theme) =>
              `linear-gradient(to bottom, transparent, ${theme.palette.background.default} 20%, ${theme.palette.background.default})`,
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
            pb: 4
          }
        }
      >
        {/* Sticky Header Control Bar */}
        <Box
          sx={{
            position: "sticky",
            top: 48,
            zIndex: 20,
            backgroundColor: "rgba(0,0,0,0)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
            mx: -2,
            px: 2,
            pt: 2,
            pb: 2,
            mb: 2,
            transition: "all 0.3s ease",
          }}
        >
          {renderToolbar ? (
            renderToolbar({
              filter,
              setFilter: updateFilter,
              listSelect,
              showEditFilter,
              view,
              operations,
              zoomable,
              onEdit,
              onDelete,
            })
          ) : (
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
          )}

          {totalCount > filter.itemsPerPage && (
            <Box display="flex" justifyContent="center" mt={2}>
              <Box display="flex" flexDirection="column" alignItems="center">
                <Pagination
                  itemsPerPage={filter.itemsPerPage}
                  currentPage={filter.currentPage}
                  totalItems={totalCount}
                  onChangePage={onChangePage}
                  pagePopupPlacement="bottom"
                />
                <Box textAlign="center" mt={1}>
                  <PaginationIndex
                    itemsPerPage={filter.itemsPerPage}
                    currentPage={filter.currentPage}
                    totalItems={totalCount}
                  />
                </Box>
              </Box>
            </Box>
          )}
        </Box>

        <FilterTags
          criteria={filter.criteria}
          onEditCriterion={(c) => showEditFilter(c.criterionOption.type)}
          onRemoveCriterion={(c) =>
            updateFilter(filter.removeCriterion(c.criterionOption.type))
          }
          onRemoveAll={() => updateFilter(filter.clearCriteria())}
        />

        {modal}

        <PagedList
          result={result}
          cachedResult={cachedResult}
          filter={filter}
          totalCount={totalCount}
          onChangePage={onChangePage}
          hidePagination={true}
          allowSkeleton={true}
        >
          {renderContent(
            result,
            effectiveFilter,
            selectedIds,
            onSelectChange
          )}
        </PagedList>

        {totalCount > filter.itemsPerPage && (
          <Box display="flex" justifyContent="center" mt={4}>
            <div className="pagination-footer">
              <Pagination
                itemsPerPage={filter.itemsPerPage}
                currentPage={filter.currentPage}
                totalItems={totalCount}
                onChangePage={onChangePage}
                pagePopupPlacement="top"
              />
              <Box textAlign="center" mt={1}>
                <PaginationIndex
                  itemsPerPage={filter.itemsPerPage}
                  currentPage={filter.currentPage}
                  totalItems={totalCount}
                />
              </Box>
            </div>
          </Box>
        )}
      </Box>
    );
  };

export const GroupList: React.FC<IGroupList> = PatchComponent(
  "GroupList",
  ({
    filterHook,
    alterQuery,
    defaultFilter,
    view,
    fromGroupId,
    onMove,
    selectable,
    renderToolbar,
    otherOperations: providedOperations = [],
  }) => {
    const intl = useIntl();
    const history = useHistory();
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [isExportAll, setIsExportAll] = useState(false);

    const otherOperations = [
      {
        text: intl.formatMessage({ id: "actions.view_random" }),
        onClick: viewRandom,
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
      ...providedOperations,
    ];

    function addKeybinds(
      result: GQL.FindGroupsQueryResult,
      filter: ListFilterModel
    ) {
      Mousetrap.bind("p r", () => {
        viewRandom(result, filter);
      });

      return () => {
        Mousetrap.unbind("p r");
      };
    }

    async function viewRandom(
      result: GQL.FindGroupsQueryResult,
      filter: ListFilterModel
    ) {
      // query for a random image
      if (result.data?.findGroups) {
        const { count } = result.data.findGroups;

        const index = Math.floor(Math.random() * count);
        const filterCopy = cloneDeep(filter);
        filterCopy.itemsPerPage = 1;
        filterCopy.currentPage = index + 1;
        const singleResult = await queryFindGroups(filterCopy);
        if (singleResult.data.findGroups.groups.length === 1) {
          const { id } = singleResult.data.findGroups.groups[0];
          // navigate to the group page
          history.push(`/groups/${id}`);
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
      result: GQL.FindGroupsQueryResult,
      filter: ListFilterModel,
      selectedIds: Set<string>,
      onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void
    ) {
      return (
        <>
          <GroupExportDialog
            open={isExportDialogOpen}
            selectedIds={selectedIds}
            isExportAll={isExportAll}
            onClose={() => setIsExportDialogOpen(false)}
          />
          {filter.displayMode === DisplayMode.Grid && (
            <GroupCardGrid
              groups={result.data?.findGroups.groups ?? []}
              zoomIndex={filter.zoomIndex}
              itemsPerPage={filter.itemsPerPage}
              selectedIds={selectedIds}
              onSelectChange={onSelectChange}
              fromGroupId={fromGroupId}
              onMove={onMove}
              loading={result.loading}
            />
          )}
        </>
      );
    }

    function renderEditDialog(
      selectedGroups: GQL.ListGroupDataFragment[],
      onClose: (applied: boolean) => void
    ) {
      return <EditGroupsDialog selected={selectedGroups} onClose={onClose} />;
    }

    function renderDeleteDialog(
      selectedGroups: GQL.SlimGroupDataFragment[],
      onClose: (confirmed: boolean) => void
    ) {
      return (
        <DeleteEntityDialog
          selected={selectedGroups}
          onClose={onClose}
          singularEntity={intl.formatMessage({ id: "group" })}
          pluralEntity={intl.formatMessage({ id: "groups" })}
          destroyMutation={useGroupsDestroy}
        />
      );
    }

    return (
      <GroupListContext
        alterQuery={alterQuery}
        filterHook={filterHook}
        view={view}
        defaultFilter={defaultFilter}
        selectable={selectable}
      >
        <GroupListContent
          view={view}
          otherOperations={otherOperations}
          addKeybinds={addKeybinds}
          renderContent={renderContent}
          renderEditDialog={renderEditDialog}
          renderDeleteDialog={renderDeleteDialog}
          renderToolbar={renderToolbar}
        />
      </GroupListContext>
    );
  }
);
