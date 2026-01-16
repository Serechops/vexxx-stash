import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Box, FormControlLabel, Checkbox } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { ClearableInput } from "src/components/Shared/ClearableInput";
import {
  IHierarchicalLabelValue,
  ILabeledId,
  ILabeledValueListValue,
} from "src/models/list-filter/types";
import { cloneDeep } from "lodash-es";
import {
  ModifierCriterion,
  IHierarchicalLabeledIdCriterion,
} from "src/models/list-filter/criteria/criterion";
import { defineMessages, MessageDescriptor, useIntl } from "react-intl";
import { CriterionModifier } from "src/core/generated-graphql";
import { keyboardClickHandler } from "src/utils/keyboard";
import { useDebounce } from "src/hooks/debounce";
import useFocus from "src/utils/focus";
import cx from "classnames";
import ScreenUtils from "src/utils/screen";
import { NumberField } from "src/utils/form";

interface ISelectedItem {
  label: string;
  excluded?: boolean;
  onClick: () => void;
  // true if the object is a special modifier value
  modifier?: boolean;
}

const SelectedItem: React.FC<ISelectedItem> = ({
  label,
  excluded = false,
  onClick,
  modifier = false,
}) => {
  const iconClassName = excluded ? "exclude-icon" : "include-button";
  const [hovered, setHovered] = useState(false);

  const icon = useMemo(() => {
    if (!hovered) {
      return excluded ? <CancelIcon fontSize="small" /> : <CheckCircleIcon fontSize="small" />;
    }

    return <CancelOutlinedIcon fontSize="small" />;
  }, [hovered, excluded]);

  return (
    <Box
      component="li"
      sx={{
        cursor: "pointer",
        height: "2em",
        mb: 0.5,
        fontStyle: modifier ? "italic" : "normal",
        "&:hover .include-button, &:hover .exclude-icon": {
          color: "common.white",
        },
      }}
    >
      <Box
        component="a"
        onClick={() => onClick()}
        onKeyDown={keyboardClickHandler(onClick)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        tabIndex={0}
        sx={{
          alignItems: "center",
          display: "flex",
          height: "2em",
          justifyContent: "space-between",
          outline: "none",
          color: "text.primary",
          textDecoration: "none",
          "&:hover, &:focus-visible": {
            backgroundColor: "action.hover",
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", overflow: "hidden" }}>
          <Box component="span" sx={{ mr: 1, color: excluded ? "error.main" : "success.main", display: "flex", alignItems: "center" }}>
            <span className={iconClassName}>{icon}</span>
          </Box>
          <Box component="span" sx={{ opacity: modifier ? 0.6 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span className={excluded ? "excluded-object-label" : "selected-object-label"}>{label}</span>
          </Box>
        </Box>
        <Box></Box>
      </Box>
    </Box>
  );
};

const UnselectedItem: React.FC<{
  onSelect: (exclude: boolean) => void;
  label: string;
  canExclude: boolean;
  // true if the object is a special modifier value
  modifier?: boolean;
}> = ({ onSelect, label, canExclude, modifier = false }) => {
  return (
    <Box
      component="li"
      sx={{
        cursor: "pointer",
        height: "2em",
        mb: 0.5,
        opacity: 0.8,
        fontStyle: modifier ? "italic" : "normal",
      }}
    >
      <Box
        component="a"
        onClick={() => onSelect(false)}
        onKeyDown={keyboardClickHandler(() => onSelect(false))}
        tabIndex={0}
        sx={{
          alignItems: "center",
          display: "flex",
          height: "2em",
          justifyContent: "space-between",
          outline: "none",
          color: "text.primary",
          textDecoration: "none",
          "&:hover, &:focus-visible": {
            backgroundColor: "action.hover",
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", overflow: "hidden" }}>
          <Box component="span" sx={{ mr: 1, color: "success.main", display: "flex", alignItems: "center" }}>
            <AddIcon fontSize="small" className="include-button" />
          </Box>
          <Box component="span" sx={{ opacity: modifier ? 0.6 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span className="unselected-object-label">{label}</span>
          </Box>
        </Box>
        <Box>
          {/* TODO item count */}
          {/* <span className="object-count">{p.id}</span> */}
          {canExclude && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onSelect(true);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              size="small"
              variant="text"
              sx={{
                minWidth: "auto",
                padding: "2px 4px",
                color: "text.primary",
                "&:hover": {
                  backgroundColor: "inherit",
                  "& .exclude-button-text": { display: "inline" }
                },
                "&:focus .exclude-button-text": { display: "inline" }
              }}
            >
              <Box
                component="span"
                className="exclude-button-text"
                sx={{
                  color: "error.main",
                  display: "none",
                  fontSize: "12px",
                  fontWeight: 600,
                  mr: 0.5
                }}
              >
                exclude
              </Box>
              <Box component="span" sx={{ color: "error.main", display: "flex", alignItems: "center" }}>
                <RemoveIcon fontSize="small" className="exclude-icon" />
              </Box>
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
};

interface ISelectableFilter {
  query: string;
  onQueryChange: (query: string) => void;
  modifier: CriterionModifier;
  showModifierValues: boolean;
  inputFocus: ReturnType<typeof useFocus>;
  canExclude: boolean;
  queryResults: ILabeledId[];
  selected: ILabeledId[];
  excluded: ILabeledId[];
  onSelect: (value: ILabeledId, exclude: boolean) => void;
  onUnselect: (value: ILabeledId) => void;
  onSetModifier: (modifier: CriterionModifier) => void;
  // true if the filter is for a single value
  singleValue?: boolean;
}

type SpecialValue = "any" | "none" | "any_of" | "only";

function modifierValueToModifier(key: SpecialValue): CriterionModifier {
  switch (key) {
    case "any":
      return CriterionModifier.NotNull;
    case "none":
      return CriterionModifier.IsNull;
    case "any_of":
      return CriterionModifier.Includes;
    case "only":
      return CriterionModifier.Equals;
  }
}

const SelectableFilter: React.FC<ISelectableFilter> = ({
  query,
  onQueryChange,
  modifier,
  showModifierValues,
  inputFocus,
  canExclude,
  queryResults,
  selected,
  excluded,
  onSelect,
  onUnselect,
  onSetModifier,
  singleValue,
}) => {
  const intl = useIntl();
  const objects = useMemo(() => {
    if (
      modifier === CriterionModifier.IsNull ||
      modifier === CriterionModifier.NotNull
    ) {
      return [];
    }
    return queryResults.filter(
      (p) =>
        selected.find((s) => s.id === p.id) === undefined &&
        excluded.find((s) => s.id === p.id) === undefined
    );
  }, [modifier, queryResults, selected, excluded]);

  const includingOnly = modifier == CriterionModifier.Equals;
  const excludingOnly =
    modifier == CriterionModifier.Excludes ||
    modifier == CriterionModifier.NotEquals;

  const modifierValues = useMemo(() => {
    return {
      any: modifier === CriterionModifier.NotNull,
      none: modifier === CriterionModifier.IsNull,
      any_of: !singleValue && modifier === CriterionModifier.Includes,
      only: !singleValue && modifier === CriterionModifier.Equals,
    };
  }, [modifier, singleValue]);

  const defaultModifier = useMemo(() => {
    if (singleValue) {
      return CriterionModifier.Includes;
    }
    return CriterionModifier.IncludesAll;
  }, [singleValue]);

  const availableModifierValues: Record<SpecialValue, boolean> = useMemo(() => {
    return {
      any:
        modifier === defaultModifier &&
        selected.length === 0 &&
        excluded.length === 0,
      none:
        modifier === defaultModifier &&
        selected.length === 0 &&
        excluded.length === 0,
      any_of:
        !singleValue && modifier === defaultModifier && selected.length > 1,
      only:
        !singleValue &&
        modifier === defaultModifier &&
        selected.length > 0 &&
        excluded.length === 0,
    };
  }, [singleValue, defaultModifier, modifier, selected, excluded]);

  function onModifierValueSelect(key: SpecialValue) {
    const m = modifierValueToModifier(key);
    onSetModifier(m);
  }

  function onModifierValueUnselect() {
    onSetModifier(defaultModifier);
  }

  return (
    <Box className="selectable-filter">
      <ClearableInput
        focus={inputFocus}
        value={query}
        setValue={(v) => onQueryChange(v)}
        placeholder={`${intl.formatMessage({ id: "actions.search" })}…`}
      />
      <Box
        component="ul"
        sx={{
          listStyleType: "none",
          mt: 0.5,
          mb: 0.25,
          maxHeight: 300,
          overflowY: "auto",
          pb: 0.15,
          paddingInlineStart: 0,
        }}
      >
        {Object.entries(modifierValues).map(([key, value]) => {
          if (!value) {
            return null;
          }

          return (
            <SelectedItem
              key={key}
              onClick={() => onModifierValueUnselect()}
              label={`(${intl.formatMessage({
                id: `criterion_modifier_values.${key}`,
              })})`}
              modifier
            />
          );
        })}
        {selected.map((p) => (
          <SelectedItem
            key={p.id}
            label={p.label}
            excluded={excludingOnly}
            onClick={() => onUnselect(p)}
          />
        ))}
        {excluded.map((p) => (
          <Box component="li" key={p.id} className="excluded-object">
            <SelectedItem
              label={p.label}
              excluded
              onClick={() => onUnselect(p)}
            />
          </Box>
        ))}
        {showModifierValues && (
          <>
            {Object.entries(availableModifierValues).map(([key, value]) => {
              if (!value) {
                return null;
              }

              return (
                <UnselectedItem
                  key={key}
                  onSelect={() => onModifierValueSelect(key as SpecialValue)}
                  label={`(${intl.formatMessage({
                    id: `criterion_modifier_values.${key}`,
                  })})`}
                  canExclude={false}
                  modifier
                />
              );
            })}
          </>
        )}
        {objects.map((p) => (
          <UnselectedItem
            key={p.id}
            onSelect={(exclude) => onSelect(p, exclude)}
            label={p.label}
            canExclude={canExclude && !includingOnly && !excludingOnly}
          />
        ))}
      </Box>
    </Box>
  );
};

interface IObjectsFilter<T extends ModifierCriterion<ILabeledValueListValue>> {
  criterion: T;
  setCriterion: (criterion: T) => void;
  useResults: (query: string) => { results: ILabeledId[]; loading: boolean };
  singleValue?: boolean;
}

export const ObjectsFilter = <
  T extends ModifierCriterion<ILabeledValueListValue | IHierarchicalLabelValue>
>({
  criterion,
  setCriterion,
  useResults,
  singleValue,
}: IObjectsFilter<T>) => {
  const [query, setQuery] = useState("");
  const [displayQuery, setDisplayQuery] = useState(query);

  const debouncedSetQuery = useDebounce(setQuery, 250);
  const onQueryChange = useCallback(
    (input: string) => {
      setDisplayQuery(input);
      debouncedSetQuery(input);
    },
    [debouncedSetQuery, setDisplayQuery]
  );

  const [queryResults, setQueryResults] = useState<ILabeledId[]>([]);
  const { results, loading: resultsLoading } = useResults(query);
  useEffect(() => {
    if (!resultsLoading) {
      setQueryResults(results);
    }
  }, [results, resultsLoading]);

  const inputFocus = useFocus();
  const [, setInputFocus] = inputFocus;

  function onSelect(value: ILabeledId, newExclude: boolean) {
    let newCriterion: T = cloneDeep(criterion);

    if (newExclude) {
      if (newCriterion.value.excluded) {
        newCriterion.value.excluded.push(value);
      } else {
        newCriterion.value.excluded = [value];
      }
    } else {
      newCriterion.value.items.push(value);
    }

    setCriterion(newCriterion);

    // reset filter query after selecting
    debouncedSetQuery.cancel();
    setQuery("");
    setDisplayQuery("");

    // focus the input box
    // don't do this on touch devices, as it's annoying
    if (!ScreenUtils.isTouch()) {
      setInputFocus();
    }
  }

  const onUnselect = useCallback(
    (value: ILabeledId) => {
      if (!criterion) return;

      let newCriterion: T = cloneDeep(criterion);

      newCriterion.value.items = criterion.value.items.filter(
        (v) => v.id !== value.id
      );
      newCriterion.value.excluded = criterion.value.excluded.filter(
        (v) => v.id !== value.id
      );

      setCriterion(newCriterion);

      // focus the input box
      setInputFocus();
    },
    [criterion, setCriterion, setInputFocus]
  );

  const onSetModifier = useCallback(
    (modifier: CriterionModifier) => {
      let newCriterion: T = criterion.clone();
      newCriterion.modifier = modifier;
      setCriterion(newCriterion);
    },
    [criterion, setCriterion]
  );

  const sortedSelected = useMemo(() => {
    const ret = criterion.value.items.slice();
    ret.sort((a, b) => a.label.localeCompare(b.label));
    return ret;
  }, [criterion]);

  const sortedExcluded = useMemo(() => {
    if (!criterion.value.excluded) return [];
    const ret = criterion.value.excluded.slice();
    ret.sort((a, b) => a.label.localeCompare(b.label));
    return ret;
  }, [criterion]);

  // if excludes is not a valid modifierOption then we can use `value.excluded`
  const canExclude =
    criterion
      .modifierCriterionOption()
      .modifierOptions.find((m) => m === CriterionModifier.Excludes) ===
    undefined;

  return (
    <SelectableFilter
      query={displayQuery}
      onQueryChange={onQueryChange}
      modifier={criterion.modifier}
      showModifierValues={!query}
      inputFocus={inputFocus}
      canExclude={canExclude}
      selected={sortedSelected}
      queryResults={queryResults}
      onSelect={onSelect}
      onUnselect={onUnselect}
      excluded={sortedExcluded}
      onSetModifier={onSetModifier}
      singleValue={singleValue}
    />
  );
};

interface IHierarchicalObjectsFilter<T extends IHierarchicalLabeledIdCriterion>
  extends IObjectsFilter<T> { }

export const HierarchicalObjectsFilter = <
  T extends IHierarchicalLabeledIdCriterion
>(
  props: IHierarchicalObjectsFilter<T>
) => {
  const intl = useIntl();
  const { criterion, setCriterion } = props;

  const messages = defineMessages({
    studio_depth: {
      id: "studio_depth",
      defaultMessage: "Levels (empty for all)",
    },
  });

  function onDepthChanged(depth: number) {
    let newCriterion: T = cloneDeep(criterion);
    newCriterion.value.depth = depth;
    setCriterion(newCriterion);
  }

  function criterionOptionTypeToIncludeID(): string {
    if (criterion.criterionOption.type === "studios") {
      return "include-sub-studios";
    }
    if (criterion.criterionOption.type === "children") {
      return "include-parent-tags";
    }
    return "include-sub-tags";
  }

  function criterionOptionTypeToIncludeUIString(): MessageDescriptor {
    const optionType =
      criterion.criterionOption.type === "studios"
        ? "include_sub_studios"
        : criterion.criterionOption.type === "children"
          ? "include_parent_tags"
          : "include_sub_tags";
    return {
      id: optionType,
    };
  }

  return (
    <Box>
      <Box mb={1}>
        <FormControlLabel
          control={
            <Checkbox
              id={criterionOptionTypeToIncludeID()}
              checked={
                criterion.modifier !== CriterionModifier.Equals &&
                criterion.value.depth !== 0
              }
              onChange={() => onDepthChanged(criterion.value.depth !== 0 ? 0 : -1)}
              disabled={criterion.modifier === CriterionModifier.Equals}
              size="small"
            />
          }
          label={intl.formatMessage(criterionOptionTypeToIncludeUIString())}
        />
      </Box>

      {criterion.value.depth !== 0 && (
        <Box mb={1}>
          <NumberField
            className="btn-secondary"
            placeholder={intl.formatMessage(messages.studio_depth)}
            onChange={(e) =>
              onDepthChanged(e.target.value ? parseInt(e.target.value, 10) : -1)
            }
            defaultValue={
              criterion.value && criterion.value.depth !== -1
                ? criterion.value.depth
                : ""
            }
            min="1"
          />
        </Box>
      )}
      <ObjectsFilter {...props} />
    </Box>
  );
};
