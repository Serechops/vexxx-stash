import React, { useEffect, useMemo, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import cx from "classnames";

import { useToast } from "src/hooks/Toast";
import { useDebounce } from "src/hooks/debounce";
import { IHasID } from "src/utils/data";

export type Option<T> = { value: string; object: T };

const CREATE_VALUE = "__create__";

function isCreate<T>(opt: Option<T>) {
  return opt.value === CREATE_VALUE;
}

export interface IFilterValueProps<T> {
  values?: T[];
  onSelect?: (item: T[]) => void;
}

export interface IFilterProps {
  noSelectionString?: string;
  className?: string;
  active?: boolean;
  isMulti?: boolean;
  isClearable?: boolean;
  isDisabled?: boolean;
  creatable?: boolean;
  menuPortalTarget?: HTMLElement | null;
}

export interface IFilterComponentProps<T> extends IFilterProps {
  loadOptions: (inputValue: string) => Promise<Option<T>[]>;
  onCreate?: (
    name: string
  ) => Promise<{ value: string; item: T; message: string }>;
  getNamedObject?: (id: string, name: string) => T;
  isValidNewOption?: (inputValue: string, options: T[]) => boolean;
}

export interface IFilterIDProps<T> {
  ids?: string[];
  onSelect?: (item: T[]) => void;
}

export function toOption<T extends IHasID>(item: T): Option<T> {
  return { value: item.id, object: item };
}

interface IFilterSelectProps<T, IsMulti extends boolean> {
  isMulti: IsMulti;
  placeholder?: string;
  closeMenuOnSelect?: boolean;
  /** Custom option row renderer in the dropdown. */
  renderOption?: (option: T, inputValue: string) => React.ReactNode;
  /** Custom chip label renderer for multi-select tags. */
  renderTag?: (option: T) => React.ReactNode;
  /** String label used in the input field. Defaults to `object.name`. */
  getOptionLabel?: (option: Option<T>) => string;
}

export const FilterSelectComponent = <
  T extends IHasID,
  IsMulti extends boolean
>(
  props: IFilterValueProps<T> &
    IFilterComponentProps<T> &
    IFilterSelectProps<T, IsMulti>
) => {
  const {
    values,
    isMulti,
    onSelect,
    creatable = false,
    isValidNewOption,
    getNamedObject,
    loadOptions,
    renderOption,
    renderTag,
    isDisabled = false,
    isClearable = true,
    placeholder,
    className,
    closeMenuOnSelect,
  } = props;

  const [inputValue, setInputValue] = useState("");
  const [asyncOptions, setAsyncOptions] = useState<Option<T>[]>([]);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const Toast = useToast();

  const getLabel =
    props.getOptionLabel ??
    ((opt: Option<T>) => (opt.object as any).name ?? opt.value);

  const debouncedLoad = useDebounce(async (value: string) => {
    setAsyncLoading(true);
    try {
      setAsyncOptions(await loadOptions(value));
    } finally {
      setAsyncLoading(false);
    }
  }, 100);

  // Load default options on mount
  useEffect(() => {
    debouncedLoad("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInputChange = (_: React.SyntheticEvent, value: string) => {
    setInputValue(value);
    debouncedLoad(value);
  };

  const options = useMemo((): Option<T>[] => {
    const opts = [...asyncOptions];
    if (
      creatable &&
      inputValue &&
      isValidNewOption?.(inputValue, asyncOptions.map((o) => o.object))
    ) {
      opts.push({
        value: CREATE_VALUE,
        object: getNamedObject?.("", inputValue) as T,
      });
    }
    return opts;
  }, [asyncOptions, inputValue, creatable, isValidNewOption, getNamedObject]);

  const selectedOptions = useMemo((): Option<T>[] => {
    if (!values?.length) return [];
    return values.map((v) => ({ value: v.id, object: v }));
  }, [values]);

  const handleChange = async (
    _: React.SyntheticEvent,
    newValue: Option<T> | Option<T>[] | null
  ) => {
    if (newValue === null) {
      onSelect?.([]);
      return;
    }

    const items = Array.isArray(newValue) ? newValue : [newValue];
    const createItem = items.find(isCreate);

    if (createItem && props.onCreate && getNamedObject) {
      setCreating(true);
      try {
        const {
          value: newId,
          item: newObj,
          message,
        } = await props.onCreate!(inputValue);
        const newOpt: Option<T> = { value: newId, object: newObj };
        const existingItems = items.filter((i) => !isCreate(i));
        const final = isMulti ? [...existingItems, newOpt] : [newOpt];
        onSelect?.(final.map((o) => o.object));
        Toast.success(
          <span>
            {message}: <b>{inputValue}</b>
          </span>
        );
        setInputValue("");
      } catch (e) {
        Toast.error(e);
      } finally {
        setCreating(false);
      }
      return;
    }

    onSelect?.(items.filter((i) => !isCreate(i)).map((o) => o.object));
  };

  const loading = asyncLoading || creating;
  const shouldClose = closeMenuOnSelect ?? !isMulti;

  return (
    <Autocomplete<Option<T>, IsMulti, boolean, false>
      className={cx("vexxx-filter-select", className)}
      multiple={isMulti as IsMulti}
      disableClearable={!isClearable as any}
      options={options}
      value={(isMulti ? selectedOptions : selectedOptions[0] ?? null) as any}
      inputValue={inputValue}
      onInputChange={handleInputChange}
      onChange={handleChange as any}
      loading={loading}
      filterOptions={(opts) => opts}
      isOptionEqualToValue={(opt, val) => opt.value === val.value}
      getOptionLabel={(opt) => {
        if (isCreate(opt)) return `Create "${inputValue}"`;
        return getLabel(opt);
      }}
      disabled={isDisabled}
      noOptionsText="None"
      disableCloseOnSelect={!shouldClose}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="outlined"
          size="small"
          placeholder={isDisabled ? "" : placeholder}
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading && <CircularProgress color="inherit" size={16} />}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
      renderOption={(liProps, option, state) => {
        const { key, ...rest } = liProps as any;
        if (isCreate(option)) {
          return (
            <li {...rest} key="__create__">
              <em>Create &ldquo;{inputValue}&rdquo;</em>
            </li>
          );
        }
        return (
          <li {...rest} key={option.value}>
            {renderOption
              ? renderOption(option.object, state.inputValue)
              : getLabel(option)}
          </li>
        );
      }}
      renderTags={
        isMulti
          ? (tagValues, getTagProps) =>
              tagValues.map((option, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return (
                  <Chip
                    key={key}
                    label={
                      renderTag ? renderTag(option.object) : getLabel(option)
                    }
                    size="small"
                    {...tagProps}
                  />
                );
              })
          : undefined
      }
    />
  );
};
