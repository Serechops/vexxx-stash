import React from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { useIntl } from "react-intl";
import { getCountries } from "src/utils/country";
import { CountryLabel } from "./CountryLabel";
import { PatchComponent } from "src/patch";

interface IProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  showFlag?: boolean;
  isClearable?: boolean;
  menuPortalTarget?: HTMLElement | null;
}

const _CountrySelect: React.FC<IProps> = ({
  value,
  onChange,
  disabled = false,
  isClearable = true,
  showFlag,
  className,
}) => {
  const { locale } = useIntl();
  const options = getCountries(locale);
  const selected = options.find((opt) => opt.value === value) ?? (value ? { label: value, value } : null);

  return (
    <Autocomplete
      freeSolo
      options={options}
      value={selected}
      disableClearable={!isClearable}
      disabled={disabled || !onChange}
      className={`CountrySelect ${className ?? ""}`}
      getOptionLabel={(opt) =>
        typeof opt === "string" ? opt : (opt.label ?? "")
      }
      isOptionEqualToValue={(opt, val) =>
        (typeof opt === "string" ? opt : opt.value) ===
        (typeof val === "string" ? val : val.value)
      }
      onChange={(_, newValue) => {
        if (typeof newValue === "string") {
          onChange?.(newValue);
        } else if (newValue) {
          onChange?.(newValue.value ?? "");
        } else {
          onChange?.("");
        }
      }}
      onInputChange={(_, newValue, reason) => {
        if (reason === "input") onChange?.(newValue);
      }}
      renderOption={(liProps, opt) => {
        const { key, ...rest } = liProps as React.HTMLAttributes<HTMLLIElement> & { key: React.Key };
        return (
          <li {...rest} key={key}>
            <CountryLabel country={opt.value} showFlag={showFlag} />
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} size="small" placeholder="Country" />
      )}
    />
  );
};

export const CountrySelect = PatchComponent("CountrySelect", _CountrySelect);
