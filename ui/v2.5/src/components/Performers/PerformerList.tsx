import cloneDeep from "lodash-es/cloneDeep";
import React, { useCallback, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useHistory, useLocation } from "react-router-dom";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import {
  queryFindPerformers,
  useFindPerformers,
  usePerformersDestroy,
} from "src/core/StashService";
import { useFilteredItemList } from "../List/ItemList";
import { ListFilterModel } from "src/models/list-filter/filter";
import { DisplayMode } from "src/models/list-filter/types";
import { PerformerTagger } from "../Tagger/performers/PerformerTagger";
import { ExportDialog } from "../Shared/ExportDialog";
import { DeleteEntityDialog } from "../Shared/DeleteEntityDialog";
import { IPerformerCardExtraCriteria } from "./PerformerCard";
import { PerformerListTable } from "./PerformerListTable";
import { EditPerformersDialog } from "./EditPerformersDialog";
import { cmToImperial, cmToInches, kgToLbs } from "src/utils/units";
import TextUtils from "src/utils/text";
import { PerformerCardGrid } from "./PerformerCardGrid";
import { PerformerMergeModal } from "./PerformerMergeDialog";
import { View } from "../List/views";
import {
  FilteredListToolbar,
  IItemListOperation,
} from "../List/FilteredListToolbar";
import { PatchComponent, PatchContainerComponent } from "src/patch";
import useFocus from "src/utils/focus";
import {
  Sidebar,
  SidebarPane,
  SidebarPaneContent,
  SidebarStateContext,
  useSidebarState,
} from "../Shared/Sidebar";
import { useCloseEditDelete, useFilterOperations } from "../List/util";
import {
  FilteredSidebarHeader,
  useFilteredSidebarKeybinds,
} from "../List/Filters/FilterSidebar";
import { FilterTags } from "../List/FilterTags";
import { Pagination, PaginationIndex } from "../List/Pagination";
import { LoadedContent } from "../List/PagedList";
import { SidebarTagsFilter } from "../List/Filters/TagsFilter";
import { SidebarRatingFilter } from "../List/Filters/RatingFilter";
import { SidebarAgeFilter } from "../List/Filters/SidebarAgeFilter";
import { PerformerListFilterOptions } from "src/models/list-filter/performers";
import { Button, Box } from "@mui/material";
import cx from "classnames";
import { FavoritePerformerCriterionOption } from "src/models/list-filter/criteria/favorite";
import { SidebarBooleanFilter } from "../List/Filters/BooleanFilter";
import { SidebarOptionFilter } from "../List/Filters/OptionFilter";
import { GenderCriterionOption } from "src/models/list-filter/criteria/gender";
import { TagsCriterionOption } from "src/models/list-filter/criteria/tags";
import { RatingCriterionOption } from "src/models/list-filter/criteria/rating";

function getItems(result: GQL.FindPerformersQueryResult) {
  return result?.data?.findPerformers?.performers ?? [];
}

function getCount(result: GQL.FindPerformersQueryResult) {
  return result?.data?.findPerformers?.count ?? 0;
}

export const FormatHeight = (height?: number | null) => {
  const intl = useIntl();
  if (!height) {
    return "";
  }

  const [feet, inches] = cmToImperial(height);

  return (
    <Box component="span" className="performer-height">
      <Box component="span" className="height-metric" sx={{ pr: 0.5 }}>
        {intl.formatNumber(height, {
          style: "unit",
          unit: "centimeter",
          unitDisplay: "short",
        })}
      </Box>
      <Box
        component="span"
        className="height-imperial"
        sx={{
          color: "text.secondary",
          fontSize: "0.875em",
          "&::before": { content: '" ("' },
          "&::after": { content: '")"' }
        }}
      >
        {intl.formatNumber(feet, {
          style: "unit",
          unit: "foot",
          unitDisplay: "narrow",
        })}
        {intl.formatNumber(inches, {
          style: "unit",
          unit: "inch",
          unitDisplay: "narrow",
        })}
      </Box>
    </Box>
  );
};

export const FormatAge = (
  birthdate?: string | null,
  deathdate?: string | null
) => {
  if (!birthdate) {
    return "";
  }
  const age = TextUtils.age(birthdate, deathdate);

  return (
    <Box component="span" className="performer-age">
      <Box component="span" className="age">{age}</Box>
      <Box component="span" className="birthdate" sx={{ color: "text.secondary", fontSize: "0.875em" }}> ({birthdate})</Box>
    </Box>
  );
};

export const FormatWeight = (weight?: number | null) => {
  const intl = useIntl();
  if (!weight) {
    return "";
  }

  const lbs = kgToLbs(weight);

  return (
    <Box component="span" className="performer-weight">
      <Box component="span" className="weight-metric" sx={{ pr: 0.5 }}>
        {intl.formatNumber(weight, {
          style: "unit",
          unit: "kilogram",
          unitDisplay: "short",
        })}
      </Box>
      <Box
        component="span"
        className="weight-imperial"
        sx={{
          color: "text.secondary",
          fontSize: "0.875em",
          "&::before": { content: '" ("' },
          "&::after": { content: '")"' }
        }}
      >
        {intl.formatNumber(lbs, {
          style: "unit",
          unit: "pound",
          unitDisplay: "short",
        })}
      </Box>
    </Box>
  );
};

export const FormatCircumcised = (circumcised?: GQL.CircumisedEnum | null) => {
  const intl = useIntl();
  if (!circumcised) {
    return "";
  }

  return (
    <Box
      component="span"
      className="penis-circumcised"
      sx={{
        "&::before": { content: '" "' }
      }}
    >
      {intl.formatMessage({
        id: "circumcised_types." + circumcised,
      })}
    </Box>
  );
};

export const FormatPenisLength = (penis_length?: number | null) => {
  const intl = useIntl();
  if (!penis_length) {
    return "";
  }

  const inches = cmToInches(penis_length);

  return (
    <Box component="span" className="performer-penis-length">
      <Box component="span" className="penis-length-metric" sx={{ pr: 0.5 }}>
        {intl.formatNumber(penis_length, {
          style: "unit",
          unit: "centimeter",
          unitDisplay: "short",
          maximumFractionDigits: 2,
        })}
      </Box>
      <Box
        component="span"
        className="penis-length-imperial"
        sx={{
          color: "text.secondary",
          fontSize: "0.875em",
          "&::before": { content: '" ("' },
          "&::after": { content: '")"' }
        }}
      >
        {intl.formatNumber(inches, {
          style: "unit",
          unit: "inch",
          unitDisplay: "narrow",
          maximumFractionDigits: 2,
        })}
      </Box>
    </Box>
  );
};

interface IPerformerList {
  filterHook?: (filter: ListFilterModel) => ListFilterModel;
  view?: View;
  alterQuery?: boolean;
  extraCriteria?: IPerformerCardExtraCriteria;
  extraOperations?: IItemListOperation<GQL.FindPerformersQueryResult>[];
}

const PerformerList: React.FC<{
  performers: GQL.PerformerDataFragment[];
  filter: ListFilterModel;
  selectedIds: Set<string>;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  extraCriteria?: IPerformerCardExtraCriteria;
}> = PatchComponent(
  "PerformerList",
  ({ performers, filter, selectedIds, onSelectChange, extraCriteria }) => {
    if (performers.length === 0) {
      return null;
    }

    if (filter.displayMode === DisplayMode.Grid) {
      return (
        <PerformerCardGrid
          performers={performers}
          zoomIndex={filter.zoomIndex}
          selectedIds={selectedIds}
          onSelectChange={onSelectChange}
          extraCriteria={extraCriteria}
        />
      );
    }
    if (filter.displayMode === DisplayMode.List) {
      return (
        <PerformerListTable
          performers={performers}
          selectedIds={selectedIds}
          onSelectChange={onSelectChange}
        />
      );
    }
    if (filter.displayMode === DisplayMode.Tagger) {
      return <PerformerTagger performers={performers} />;
    }

    return null;
  }
);

const PerformerFilterSidebarSections = PatchContainerComponent(
  "FilteredPerformerList.SidebarSections"
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

  const AgeCriterionOption = PerformerListFilterOptions.criterionOptions.find(
    (c) => c.type === "age"
  );

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

      <PerformerFilterSidebarSections>
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
          data-type={FavoritePerformerCriterionOption.type}
          option={FavoritePerformerCriterionOption}
          filter={filter}
          setFilter={setFilter}
          sectionID="favourite"
        />
        <SidebarOptionFilter
          title={<FormattedMessage id="gender" />}
          option={GenderCriterionOption}
          filter={filter}
          setFilter={setFilter}
          sectionID="gender"
        />
        <SidebarAgeFilter
          title={<FormattedMessage id="age" />}
          option={AgeCriterionOption!}
          filter={filter}
          setFilter={setFilter}
          sectionID="age"
        />
      </PerformerFilterSidebarSections>

      <div className="sidebar-footer">
        <Button className="sidebar-close-button" onClick={onClose}>
          <FormattedMessage id={showResultsId} values={{ count }} />
        </Button>
      </div>
    </>
  );
};

function useViewRandom(filter: ListFilterModel, count: number) {
  const history = useHistory();

  const viewRandom = useCallback(async () => {
    // query for a random performer
    if (count === 0) {
      return;
    }

    const index = Math.floor(Math.random() * count);
    const filterCopy = cloneDeep(filter);
    filterCopy.itemsPerPage = 1;
    filterCopy.currentPage = index + 1;
    const singleResult = await queryFindPerformers(filterCopy);
    if (singleResult.data.findPerformers.performers.length === 1) {
      const { id } = singleResult.data.findPerformers.performers[0];
      // navigate to the performer page
      history.push(`/performers/${id}`);
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

export const FilteredPerformerList = PatchComponent(
  "FilteredPerformerList",
  (props: IPerformerList) => {
    const intl = useIntl();
    const history = useHistory();
    const location = useLocation();

    const searchFocus = useFocus();

    const {
      filterHook,
      view,
      alterQuery,
      extraCriteria,
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
          filterMode: GQL.FilterMode.Performers,
          view,
          useURL: alterQuery,
        },
        queryResultProps: {
          useResult: useFindPerformers,
          getCount: (r) => r.data?.findPerformers.count ?? 0,
          getItems: (r) => r.data?.findPerformers.performers ?? [],
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
      let newPath = "/performers/new";
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
            performers: {
              ids: Array.from(selectedIds.values()),
              all,
            },
          }}
          onClose={() => closeModal()}
        />
      );
    }

    function onEdit() {
      showModal(
        <EditPerformersDialog
          selected={selectedItems}
          onClose={onCloseEditDelete}
        />
      );
    }

    function onDelete() {
      showModal(
        <DeleteEntityDialog
          selected={selectedItems}
          onClose={onCloseEditDelete}
          singularEntity={intl.formatMessage({ id: "performer" })}
          pluralEntity={intl.formatMessage({ id: "performers" })}
          destroyMutation={usePerformersDestroy}
        />
      );
    }

    function onMerge() {
      showModal(
        <PerformerMergeModal
          performers={selectedItems}
          onClose={(mergedId?: string) => {
            closeModal();
            if (mergedId) {
              history.push(`/performers/${mergedId}`);
            }
          }}
          show
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
        text: intl.formatMessage({ id: "actions.open_random" }),
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

    const content = (
      <div
        className={cx("item-list-container performer-list", {
          "hide-sidebar": !showSidebar,
        })}
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
                <PerformerList
                  filter={effectiveFilter}
                  performers={items}
                  selectedIds={selectedIds}
                  onSelectChange={onSelectChange}
                  extraCriteria={extraCriteria}
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

    // Wrap with Box for hero positioning when on main Performers page
    if (view === View.Performers) {
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
