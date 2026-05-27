import React, { useMemo, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import MenuItem from "@mui/material/MenuItem";
import Menu from "@mui/material/Menu";
import IconButton from "@mui/material/IconButton";

import * as GQL from "src/core/generated-graphql";
import { useMarkerStrings } from "src/core/StashService";
import { objectTitle } from "src/core/files";
import { useDebounce } from "src/hooks/debounce";

import { PerformerIDSelect } from "../Performers/PerformerSelect";
import { Icon } from "./Icon";
import { faTableColumns } from "@fortawesome/free-solid-svg-icons";
import { TagIDSelect } from "../Tags/TagSelect";
import { StudioIDSelect } from "../Studios/StudioSelect";
import { GalleryIDSelect } from "../Galleries/GallerySelect";
import { GroupIDSelect } from "../Groups/GroupSelect";
import { SceneIDSelect } from "../Scenes/SceneSelect";

export type SelectObject = {
  id: string;
  name?: string | null;
  title?: string | null;
};
type Option = { value: string; label: string };

interface ITypeProps {
  type?:
  | "performers"
  | "studios"
  | "tags"
  | "scene_tags"
  | "performer_tags"
  | "scenes"
  | "groups"
  | "galleries";
}
interface IFilterProps {
  ids?: string[];
  initialIds?: string[];
  onSelect?: (item: SelectObject[]) => void;
  noSelectionString?: string;
  className?: string;
  isMulti?: boolean;
  isClearable?: boolean;
  isDisabled?: boolean;
  creatable?: boolean;
  menuPortalTarget?: HTMLElement | null;
}

type TitledObject = { id: string; title: string };
interface ITitledSelect {
  className?: string;
  selected: TitledObject[];
  onSelect: (items: TitledObject[]) => void;
  isMulti?: boolean;
  disabled?: boolean;
}

export const GallerySelect: React.FC<
  IFilterProps & { excludeIds?: string[] }
> = (props) => {
  return <GalleryIDSelect {...props} />;
};

export const SceneSelect: React.FC<IFilterProps & { excludeIds?: string[] }> = (
  props
) => {
  return <SceneIDSelect {...props} />;
};

export const ImageSelect: React.FC<ITitledSelect> = (props) => {
  const [query, setQuery] = useState<string>("");
  const { data, loading } = GQL.useFindImagesQuery({
    skip: query === "",
    variables: { filter: { q: query } },
  });

  const images = data?.findImages.images ?? [];
  const options = images.map((s) => ({ label: objectTitle(s), value: s.id }));

  const debouncedSetQuery = useDebounce(setQuery, 500);

  const selectedOptions = props.selected.map((s) => ({
    value: s.id,
    label: s.title,
  }));

  const isMulti = props.isMulti ?? false;

  return (
    <Autocomplete
      multiple={isMulti}
      options={options}
      value={isMulti ? selectedOptions : (selectedOptions[0] ?? null)}
      loading={loading}
      filterOptions={(x) => x}
      isOptionEqualToValue={(opt, val) => opt.value === val.value}
      getOptionLabel={(opt) => opt.label}
      onInputChange={(_, val) => debouncedSetQuery(val)}
      onChange={(_, newValue) => {
        const selected = Array.isArray(newValue)
          ? newValue
          : [newValue].filter(Boolean) as Option[];
        props.onSelect(selected.map((s) => ({ id: s.value, title: s.label })));
      }}
      disabled={props.disabled}
      noOptionsText={query === "" ? null : "No images found."}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          placeholder="Search for image..."
          slotProps={{
            input: { ...params.InputProps, endAdornment: null },
          }}
        />
      )}
    />
  );
};

interface IMarkerSuggestProps {
  initialMarkerTitle?: string;
  onChange: (title: string) => void;
}
export const MarkerTitleSuggest: React.FC<IMarkerSuggestProps> = (props) => {
  const { data, loading } = useMarkerStrings();
  const suggestions = data?.markerStrings ?? [];

  const items = suggestions.map((item) => item?.title ?? "");

  // If still loading, ensure the current value is present
  const allItems = useMemo(() => {
    if (
      loading &&
      props.initialMarkerTitle &&
      !items.includes(props.initialMarkerTitle)
    ) {
      return [props.initialMarkerTitle, ...items];
    }
    return items;
  }, [items, loading, props.initialMarkerTitle]);

  return (
    <Autocomplete
      freeSolo
      loading={loading}
      options={allItems}
      groupBy={() => "Previously used titles..."}
      value={props.initialMarkerTitle ?? null}
      onChange={(_, newValue) =>
        props.onChange(typeof newValue === "string" ? newValue : (newValue ?? ""))
      }
      onInputChange={(_, value) => props.onChange(value)}
      className="select-suggest"
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          placeholder="Marker title..."
          slotProps={{
            input: { ...params.InputProps, endAdornment: null },
          }}
        />
      )}
    />
  );
};

export const PerformerSelect: React.FC<IFilterProps> = (props) => {
  return <PerformerIDSelect {...props} />;
};

export const StudioSelect: React.FC<
  IFilterProps & { excludeIds?: string[] }
> = (props) => {
  return <StudioIDSelect {...props} />;
};

export const GroupSelect: React.FC<IFilterProps> = (props) => {
  return <GroupIDSelect {...props} />;
};

export const TagSelect: React.FC<
  IFilterProps & {
    excludeIds?: string[];
    hoverPlacement?: "top" | "bottom" | "left" | "right";
  }
> = (props) => {
  return <TagIDSelect {...props} />;
};

export const FilterSelect: React.FC<IFilterProps & ITypeProps> = (props) => {
  switch (props.type) {
    case "performers":
      return <PerformerSelect {...props} creatable={false} />;
    case "studios":
      return <StudioSelect {...props} creatable={false} />;
    case "scenes":
      return <SceneSelect {...props} creatable={false} />;
    case "groups":
      return <GroupSelect {...props} creatable={false} />;
    case "galleries":
      return <GallerySelect {...props} creatable={false} />;
    default:
      return <TagSelect {...props} creatable={false} />;
  }
};

interface IStringListSelect {
  options?: string[];
  value: string[];
}

export const StringListSelect: React.FC<IStringListSelect> = ({ value }) => (
  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, py: 0.5 }}>
    {value.map((v) => (
      <Chip key={v} label={v} size="small" />
    ))}
  </Box>
);

interface IListSelect<T> {
  options?: T[];
  value: T[];
  toOptionType: (v: T) => { label: string; value: string };
  fromOptionType?: (o: { label: string; value: string }) => T;
}

export const ListSelect = <T extends {}>(props: IListSelect<T>) => {
  const { value, toOptionType } = props;
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, py: 0.5 }}>
      {value.map((v) => {
        const opt = toOptionType(v);
        return <Chip key={opt.value} label={opt.label} size="small" />;
      })}
    </Box>
  );
};

type DisableOption = Option & {
  isDisabled?: boolean;
  className?: string;
};

interface ICheckBoxSelectProps {
  options: DisableOption[];
  selectedOptions?: DisableOption[];
  onChange: (item: DisableOption[]) => void;
}

export const CheckBoxSelect: React.FC<ICheckBoxSelectProps> = ({
  options,
  selectedOptions,
  onChange,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  const isSelected = (opt: DisableOption) =>
    selectedOptions?.some((s) => s.value === opt.value) ?? false;

  const handleToggle = (opt: DisableOption) => {
    if (opt.isDisabled) return;
    const current = selectedOptions ?? [];
    const next = isSelected(opt)
      ? current.filter((s) => s.value !== opt.value)
      : [...current, opt];
    onChange(next);
  };

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ height: 25, width: 25, p: 0 }}
        className="CheckBoxSelect"
      >
        <Icon icon={faTableColumns} className="column-select" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        {options.map((opt) => (
          <MenuItem
            key={opt.value}
            dense
            disabled={opt.isDisabled}
            data-value={opt.value}
            onClick={() => handleToggle(opt)}
          >
            <Checkbox
              checked={isSelected(opt)}
              disabled={opt.isDisabled}
              size="small"
              sx={{ p: 0, mr: 1 }}
            />
            <label>{opt.label}</label>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
