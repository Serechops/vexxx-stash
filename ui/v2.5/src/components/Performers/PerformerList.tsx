import cloneDeep from "lodash-es/cloneDeep";
import React, { useState } from "react";
import { Box } from "@mui/material";
import { useIntl } from "react-intl";
import { useHistory } from "react-router-dom";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import {
  queryFindPerformers,
  useFindPerformers,
  usePerformersDestroy,
} from "src/core/StashService";
import { ItemList, ItemListContext, showWhenSelected } from "../List/ItemList";
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
import { IItemListOperation } from "../List/FilteredListToolbar";
import { PatchComponent } from "src/patch";

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

export const PerformerList: React.FC<IPerformerList> = PatchComponent(
  "PerformerList",
  ({ filterHook, view, alterQuery, extraCriteria, extraOperations = [] }) => {
    const intl = useIntl();
    const history = useHistory();
    const [mergePerformers, setMergePerformers] = useState<
      GQL.SelectPerformerDataFragment[] | undefined
    >(undefined);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [isExportAll, setIsExportAll] = useState(false);

    const filterMode = GQL.FilterMode.Performers;

    const otherOperations = [
      ...extraOperations,
      {
        text: intl.formatMessage({ id: "actions.open_random" }),
        onClick: openRandom,
      },
      {
        text: `${intl.formatMessage({ id: "actions.merge" })}…`,
        onClick: merge,
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
      result: GQL.FindPerformersQueryResult,
      filter: ListFilterModel
    ) {
      Mousetrap.bind("p r", () => {
        openRandom(result, filter);
      });

      return () => {
        Mousetrap.unbind("p r");
      };
    }

    async function openRandom(
      result: GQL.FindPerformersQueryResult,
      filter: ListFilterModel
    ) {
      if (result.data?.findPerformers) {
        const { count } = result.data.findPerformers;
        const index = Math.floor(Math.random() * count);
        const filterCopy = cloneDeep(filter);
        filterCopy.itemsPerPage = 1;
        filterCopy.currentPage = index + 1;
        const singleResult = await queryFindPerformers(filterCopy);
        if (singleResult.data.findPerformers.performers.length === 1) {
          const { id } = singleResult.data.findPerformers.performers[0]!;
          history.push(`/performers/${id}`);
        }
      }
    }

    async function merge(
      result: GQL.FindPerformersQueryResult,
      filter: ListFilterModel,
      selectedIds: Set<string>
    ) {
      const selected =
        result.data?.findPerformers.performers.filter((p) =>
          selectedIds.has(p.id)
        ) ?? [];
      setMergePerformers(selected);
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
      result: GQL.FindPerformersQueryResult,
      filter: ListFilterModel,
      selectedIds: Set<string>,
      onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void
    ) {
      function renderMergeDialog() {
        if (mergePerformers) {
          return (
            <PerformerMergeModal
              performers={mergePerformers}
              onClose={(mergedId?: string) => {
                setMergePerformers(undefined);
                if (mergedId) {
                  history.push(`/performers/${mergedId}`);
                }
              }}
              show
            />
          );
        }
      }

      function maybeRenderPerformerExportDialog() {
        if (isExportDialogOpen) {
          return (
            <>
              <ExportDialog
                exportInput={{
                  performers: {
                    ids: Array.from(selectedIds.values()),
                    all: isExportAll,
                  },
                }}
                onClose={() => setIsExportDialogOpen(false)}
              />
            </>
          );
        }
      }

      function renderPerformers() {
        if (!result.data?.findPerformers) return;

        if (filter.displayMode === DisplayMode.Grid) {
          return (
            <PerformerCardGrid
              performers={result.data.findPerformers.performers}
              zoomIndex={filter.zoomIndex}
              selectedIds={selectedIds}
              onSelectChange={onSelectChange}
              extraCriteria={extraCriteria}
              loading={result.loading}
            />
          );
        }
        if (filter.displayMode === DisplayMode.List) {
          return (
            <PerformerListTable
              performers={result.data.findPerformers.performers}
              selectedIds={selectedIds}
              onSelectChange={onSelectChange}
            />
          );
        }
        if (filter.displayMode === DisplayMode.Tagger) {
          return (
            <PerformerTagger
              performers={result.data.findPerformers.performers}
            />
          );
        }
      }

      return (
        <>
          {renderMergeDialog()}
          {maybeRenderPerformerExportDialog()}
          {renderPerformers()}
        </>
      );
    }

    function renderEditDialog(
      selectedPerformers: GQL.SlimPerformerDataFragment[],
      onClose: (applied: boolean) => void
    ) {
      return (
        <EditPerformersDialog selected={selectedPerformers} onClose={onClose} />
      );
    }

    function renderDeleteDialog(
      selectedPerformers: GQL.SlimPerformerDataFragment[],
      onClose: (confirmed: boolean) => void
    ) {
      return (
        <DeleteEntityDialog
          selected={selectedPerformers}
          onClose={onClose}
          singularEntity={intl.formatMessage({ id: "performer" })}
          pluralEntity={intl.formatMessage({ id: "performers" })}
          destroyMutation={usePerformersDestroy}
        />
      );
    }

    return (
      <ItemListContext
        filterMode={filterMode}
        useResult={useFindPerformers}
        getItems={getItems}
        getCount={getCount}
        alterQuery={alterQuery}
        filterHook={filterHook}
        view={view}
        selectable
      >
        <Box
          sx={
            view === View.Performers ? {
              position: "relative",
              zIndex: 10,
              mt: { xs: 4, md: '65vh' },
              background: (theme) =>
                `linear-gradient(to bottom, transparent, ${theme.palette.background.default} 20%, ${theme.palette.background.default})`,
              minHeight: "100vh",
              transition: "margin-top 0.3s ease",
            } : {
              mt: 4
            }
          }
        >
          <ItemList
            view={view}
            otherOperations={otherOperations}
            addKeybinds={addKeybinds}
            renderContent={renderContent}
            renderEditDialog={renderEditDialog}
            renderDeleteDialog={renderDeleteDialog}
            allowSkeleton
          />
        </Box>
      </ItemListContext>
    );
  }
);
