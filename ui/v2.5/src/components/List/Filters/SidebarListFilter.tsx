import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Box } from "@mui/material";
import { Icon } from "src/components/Shared/Icon";
import {
  faCheckCircle,
  faMinus,
  faPlus,
  faTimesCircle,
} from "@fortawesome/free-solid-svg-icons";
import { faTimesCircle as faTimesCircleRegular } from "@fortawesome/free-regular-svg-icons";
import { ClearableInput } from "src/components/Shared/ClearableInput";
import { useIntl } from "react-intl";
import { keyboardClickHandler } from "src/utils/keyboard";
import { useDebounce } from "src/hooks/debounce";
import useFocus from "src/utils/focus";
import cx from "classnames";
import ScreenUtils from "src/utils/screen";
import { SidebarSection } from "src/components/Shared/Sidebar";
import { TruncatedInlineText } from "src/components/Shared/TruncatedText";

interface ISelectedItem {
  className?: string;
  label: string;
  excluded?: boolean;
  onClick: () => void;
  // true if the object is a special modifier value
  modifier?: boolean;
}

const SelectedItem: React.FC<ISelectedItem> = ({
  className,
  label,
  excluded = false,
  onClick,
  modifier = false,
}) => {
  const iconClassName = excluded ? "exclude-icon" : "include-button";
  const [hovered, setHovered] = useState(false);

  const icon = useMemo(() => {
    if (!hovered) {
      return excluded ? faTimesCircle : faCheckCircle;
    }

    return faTimesCircleRegular;
  }, [hovered, excluded]);

  return (
    <Box
      component="li"
      className={className}
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
        <Box className="label-group" sx={{ display: "flex", alignItems: "center", overflow: "hidden" }}>
          <Box component="span" sx={{ mr: 1, color: excluded ? "error.main" : "success.main" }}>
            <Icon
              className={`fa-fw ${iconClassName}`}
              icon={icon}
            />
          </Box>
          <Box component="span" sx={{ opacity: modifier ? 0.6 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <TruncatedInlineText
              text={label}
              className={excluded ? "excluded-object-label" : "selected-object-label"}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

const CandidateItem: React.FC<{
  className?: string;
  onSelect: (exclude: boolean) => void;
  label: string;
  canExclude?: boolean;
  modifier?: boolean;
  singleValue?: boolean;
}> = ({
  onSelect,
  label,
  canExclude,
  modifier = false,
  singleValue = false,
  className,
}) => {
    return (
      <Box
        component="li"
        className={className}
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
          <Box className="label-group" sx={{ display: "flex", alignItems: "center", overflow: "hidden" }}>
            <Box component="span" sx={{ mr: 1, color: "success.main", visibility: singleValue ? "hidden" : "visible" }}>
              <Icon
                className="fa-fw include-button"
                icon={faPlus}
              />
            </Box>
            <Box component="span" sx={{ opacity: modifier ? 0.6 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <TruncatedInlineText
                className="unselected-object-label"
                text={label}
              />
            </Box>
          </Box>
          <Box>
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
                <Box component="span" sx={{ color: "error.main" }}>
                  <Icon
                    className="fa-fw exclude-icon"
                    icon={faMinus}
                  />
                </Box>
              </Button>
            )}
          </Box>
        </Box>
      </Box>
    );
  };

export type Option<T = unknown> = {
  id: string;
  className?: string;
  value?: T;
  label: string;
  canExclude?: boolean; // defaults to true
};

export const SelectedList: React.FC<{
  items: Option[];
  onUnselect: (item: Option) => void;
  excluded?: boolean;
}> = ({ items, onUnselect, excluded }) => {
  if (items.length === 0) {
    return null;
  }

  return (
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
      {items.map((p) => (
        <SelectedItem
          key={p.id}
          className={p.className}
          label={p.label}
          excluded={excluded}
          onClick={() => onUnselect(p)}
        />
      ))}
    </Box>
  );
};
// ... QueryField ...
const QueryField: React.FC<{
  focus: ReturnType<typeof useFocus>;
  value: string;
  setValue: (query: string) => void;
}> = ({ focus, value, setValue }) => {
  const intl = useIntl();

  const [displayQuery, setDisplayQuery] = useState(value);
  const debouncedSetQuery = useDebounce(setValue, 250);

  useEffect(() => {
    setDisplayQuery(value);
  }, [value]);

  const onQueryChange = useCallback(
    (input: string) => {
      setDisplayQuery(input);
      debouncedSetQuery(input);
    },
    [debouncedSetQuery, setDisplayQuery]
  );

  return (
    <ClearableInput
      focus={focus}
      value={displayQuery}
      setValue={(v) => onQueryChange(v)}
      placeholder={`${intl.formatMessage({ id: "actions.search" })}…`}
    />
  );
};

interface IQueryableProps {
  inputFocus?: ReturnType<typeof useFocus>;
  query?: string;
  setQuery?: (query: string) => void;
}

export const CandidateList: React.FC<
  {
    items: Option[];
    onSelect: (item: Option, exclude: boolean) => void;
    canExclude?: boolean;
    singleValue?: boolean;
  } & IQueryableProps
> = ({
  inputFocus,
  query,
  setQuery,
  items,
  onSelect,
  canExclude,
  singleValue,
}) => {
    const showQueryField =
      inputFocus !== undefined && query !== undefined && setQuery !== undefined;

    return (
      <Box className="queryable-candidate-list">
        {showQueryField && (
          <Box mb={0.5}>
            <QueryField
              focus={inputFocus}
              value={query}
              setValue={(v) => setQuery(v)}
            />
          </Box>
        )}
        <Box
          component="ul"
          sx={{
            listStyleType: "none",
            mb: 0.25,
            maxHeight: 300,
            overflowY: "auto",
            pb: 0.15,
            paddingInlineStart: 0,
          }}
        >
          {items.map((p) => (
            <CandidateItem
              key={p.id}
              className={p.className}
              onSelect={(exclude) => onSelect(p, exclude)}
              label={p.label}
              canExclude={canExclude && (p.canExclude ?? true)}
              singleValue={singleValue}
            />
          ))}
        </Box>
      </Box>
    );
  };

export const SidebarListFilter: React.FC<{
  title: React.ReactNode;
  selected: Option[];
  excluded?: Option[];
  candidates: Option[];
  singleValue?: boolean;
  onSelect: (item: Option, exclude: boolean) => void;
  onUnselect: (item: Option, exclude: boolean) => void;
  canExclude?: boolean;
  query?: string;
  setQuery?: (query: string) => void;
  preSelected?: React.ReactNode;
  postSelected?: React.ReactNode;
  preCandidates?: React.ReactNode;
  postCandidates?: React.ReactNode;
  onOpen?: () => void;
  // used to store open/closed state in SidebarStateContext
  sectionID?: string;
}> = ({
  title,
  selected,
  excluded,
  candidates,
  onSelect,
  onUnselect,
  canExclude,
  query,
  setQuery,
  singleValue = false,
  preCandidates,
  postCandidates,
  preSelected,
  postSelected,
  onOpen,
  sectionID,
}) => {
    // TODO - sort items?

    const inputFocus = useFocus();
    const [, setInputFocus] = inputFocus;

    function unselectHook(item: Option, exclude: boolean) {
      onUnselect(item, exclude);

      // focus the input box
      // don't do this on touch devices, as it's annoying
      if (!ScreenUtils.isTouch()) {
        setInputFocus();
      }
    }

    function selectHook(item: Option, exclude: boolean) {
      onSelect(item, exclude);

      // reset filter query after selecting
      setQuery?.("");

      // focus the input box
      // don't do this on touch devices, as it's annoying
      if (!ScreenUtils.isTouch()) {
        setInputFocus();
      }
    }

    return (
      <SidebarSection
        text={title}
        sectionID={sectionID}
        outsideCollapse={
          <>
            {preSelected ? <Box sx={{ pt: 0.25, minHeight: "2em" }}>{preSelected}</Box> : null}
            <SelectedList
              items={selected}
              onUnselect={(i) => unselectHook(i, false)}
            />
            {excluded && (
              <SelectedList
                items={excluded}
                onUnselect={(i) => unselectHook(i, true)}
                excluded
              />
            )}
            {postSelected ? <Box sx={{ pt: 0.25, minHeight: "2em" }}>{postSelected}</Box> : null}
          </>
        }
        onOpen={onOpen}
      >
        {preCandidates ? <Box sx={{ pt: 0.25, minHeight: "2em" }}>{preCandidates}</Box> : null}
        <CandidateList
          items={candidates}
          onSelect={selectHook}
          canExclude={canExclude}
          inputFocus={inputFocus}
          query={query}
          setQuery={setQuery}
          singleValue={singleValue}
        />
        {postCandidates ? <Box sx={{ pt: 0.25, minHeight: "2em" }}>{postCandidates}</Box> : null}
      </SidebarSection>
    );
  };

export function useStaticResults<T>(r: T) {
  return () => ({ results: r, loading: false });
}
