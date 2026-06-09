import React, { useMemo } from "react";
import {
  Autocomplete,
  TextField,
  createFilterOptions,
} from "@mui/material";
import { useIntl } from "react-intl";
import { Setting } from "../Inputs";
import { LANGUAGE_OPTIONS, LanguageOption } from "./languageOptions";

const filterOptions = createFilterOptions<LanguageOption>({
  stringify: (option) => `${option.label} ${option.value}`,
});

interface ILanguageSelectorProps {
  value?: string;
  onChange: (nextValue: string) => void;
}

export const LanguageSelector: React.FC<ILanguageSelectorProps> = ({
  value,
  onChange,
}) => {
  const intl = useIntl();

  const options = useMemo(() => {
    const known = LANGUAGE_OPTIONS.find((option) => option.value === value);
    if (known || !value) {
      return LANGUAGE_OPTIONS;
    }

    return [
      {
        value,
        label: intl.formatMessage(
          {
            id: "config.ui.language.custom_locale",
            defaultMessage: "Custom locale ({locale})",
          },
          { locale: value }
        ),
      },
      ...LANGUAGE_OPTIONS,
    ];
  }, [intl, value]);

  const selectedValue = useMemo(
    () => options.find((option) => option.value === value) ?? undefined,
    [options, value]
  );

  return (
    <Setting id="language" headingID="config.ui.language.heading">
      <Autocomplete<LanguageOption, false, true, false>
        disableClearable
        options={options}
        filterOptions={filterOptions}
        value={selectedValue}
        onChange={(_event, nextValue) => {
          if (nextValue) {
            onChange(nextValue.value);
          }
        }}
        getOptionLabel={(option) => option.label}
        isOptionEqualToValue={(option, selected) =>
          option.value === selected.value
        }
        size="small"
        sx={{ minWidth: 320 }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={intl.formatMessage({
              id: "config.ui.language.search_placeholder",
              defaultMessage: "Search language...",
            })}
          />
        )}
      />
    </Setting>
  );
};
