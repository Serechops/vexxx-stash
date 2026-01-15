import React, { useContext, useState } from "react";
import {
  Grid,
  Typography,
  IconButton,
  TextField,
  Stack,
  Box,
} from "@mui/material";
import { Icon } from "../Icon";
import clone from "lodash-es/clone";
import { faCheck, faTimes } from "@fortawesome/free-solid-svg-icons";
import { getCountryByISO, getCountries } from "src/utils/country";
import { CountrySelect } from "../CountrySelect";
import { StringListInput } from "../StringListInput";
import { ImageSelector } from "../ImageSelector";
import { ScrapeResult } from "./scrapeResult";
import { ScrapeDialogContext } from "./ScrapeDialog";

interface IScrapedFieldProps<T> {
  result: ScrapeResult<T>;
}

interface IScrapedRowProps<T> extends IScrapedFieldProps<T> {
  className?: string;
  field: string;
  title: string;
  originalField: React.ReactNode;
  newField: React.ReactNode;
  onChange: (value: ScrapeResult<T>) => void;
  newValues?: React.ReactNode;
}

export const ScrapeDialogRow = <T,>(props: IScrapedRowProps<T>) => {
  const { existingLabel, scrapedLabel } = useContext(ScrapeDialogContext);

  function handleSelectClick(isNew: boolean) {
    const ret = clone(props.result);
    ret.useNewValue = isNew;
    props.onChange(ret);
  }

  if (!props.result.scraped && !props.newValues) {
    return <></>;
  }

  function renderButtonIcon(selected: boolean) {
    return (
      <Icon
        className={`fa-fw`}
        icon={selected ? faCheck : faTimes}
      />
    );
  }

  return (
    <Grid
      container
      spacing={2}
      className={`px-3 pt-3 ${props.className ?? ""}`}
      data-field={props.field}
      alignItems="flex-start"
    >
      <Grid size={{ xs: 12, lg: 3 }}>
        <Typography variant="subtitle2" sx={{ pt: 1 }}>{props.title}</Typography>
      </Grid>

      <Grid size={{ xs: 12, lg: 9 }}>
        <Grid container spacing={2}>
          {/* Mobile labels handled differently in MUI? We can use direct labels */}
          <Grid size={{ xs: 12, lg: 6 }}>
            <Box sx={{ display: { lg: 'none' }, mb: 1 }}>
              <Typography variant="caption" color="textSecondary">{existingLabel}</Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box>
                <IconButton
                  size="small"
                  onClick={() => handleSelectClick(false)}
                  sx={{
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    mt: 0.5,
                    color: !props.result.useNewValue ? 'success.main' : 'text.disabled'
                  }}
                >
                  {renderButtonIcon(!props.result.useNewValue)}
                </IconButton>
              </Box>
              <Box flexGrow={1}>
                {props.originalField}
              </Box>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }}>
            <Box sx={{ display: { lg: 'none' }, mb: 1 }}>
              <Typography variant="caption" color="textSecondary">{scrapedLabel}</Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box>
                <IconButton
                  size="small"
                  onClick={() => handleSelectClick(true)}
                  sx={{
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    mt: 0.5,
                    color: props.result.useNewValue ? 'success.main' : 'text.disabled'
                  }}
                >
                  {renderButtonIcon(props.result.useNewValue)}
                </IconButton>
              </Box>
              <Box flexGrow={1}>
                {props.newField}
              </Box>
            </Stack>
            {props.newValues && (
              <Box mt={1}>
                {props.newValues}
              </Box>
            )}
          </Grid>
        </Grid>
      </Grid>
    </Grid>
  );
};

interface IScrapedInputGroupProps {
  isNew?: boolean;
  placeholder?: string;
  locked?: boolean;
  result: ScrapeResult<string>;
  onChange?: (value: string) => void;
}

const ScrapedInputGroup: React.FC<IScrapedInputGroupProps> = (props) => {
  return (
    <TextField
      placeholder={props.placeholder}
      value={props.isNew ? props.result.newValue : props.result.originalValue}
      InputProps={{
        readOnly: !props.isNew || props.locked,
      }}
      onChange={(e) => {
        if (props.isNew && props.onChange) {
          props.onChange(e.target.value);
        }
      }}
      variant="outlined"
      size="small"
      fullWidth
      className="bg-secondary text-white border-secondary"
    />
  );
};

interface IScrapedInputGroupRowProps {
  title: string;
  field: string;
  className?: string;
  placeholder?: string;
  result: ScrapeResult<string>;
  locked?: boolean;
  onChange: (value: ScrapeResult<string>) => void;
}

export const ScrapedInputGroupRow: React.FC<IScrapedInputGroupRowProps> = (
  props
) => {
  return (
    <ScrapeDialogRow
      title={props.title}
      field={props.field}
      className={props.className}
      result={props.result}
      originalField={
        <ScrapedInputGroup
          placeholder={props.placeholder || props.title}
          result={props.result}
        />
      }
      newField={
        <ScrapedInputGroup
          placeholder={props.placeholder || props.title}
          result={props.result}
          isNew
          locked={props.locked}
          onChange={(value) =>
            props.onChange(props.result.cloneWithValue(value))
          }
        />
      }
      onChange={props.onChange}
    />
  );
};

interface IScrapedStringListProps {
  isNew?: boolean;
  placeholder?: string;
  locked?: boolean;
  result: ScrapeResult<string[]>;
  onChange?: (value: string[]) => void;
}

const ScrapedStringList: React.FC<IScrapedStringListProps> = (props) => {
  const value = props.isNew
    ? props.result.newValue
    : props.result.originalValue;

  return (
    <StringListInput
      value={value ?? []}
      setValue={(v) => {
        if (props.isNew && props.onChange) {
          props.onChange(v);
        }
      }}
      placeholder={props.placeholder}
      readOnly={!props.isNew || props.locked}
    />
  );
};

interface IScrapedStringListRowProps {
  title: string;
  field: string;
  placeholder?: string;
  result: ScrapeResult<string[]>;
  locked?: boolean;
  onChange: (value: ScrapeResult<string[]>) => void;
}

export const ScrapedStringListRow: React.FC<IScrapedStringListRowProps> = (
  props
) => {
  return (
    <ScrapeDialogRow
      className="string-list-row"
      title={props.title}
      field={props.field}
      result={props.result}
      originalField={
        <ScrapedStringList
          placeholder={props.placeholder || props.title}
          result={props.result}
        />
      }
      newField={
        <ScrapedStringList
          placeholder={props.placeholder || props.title}
          result={props.result}
          isNew
          locked={props.locked}
          onChange={(value) =>
            props.onChange(props.result.cloneWithValue(value))
          }
        />
      }
      onChange={props.onChange}
    />
  );
};

const ScrapedTextArea: React.FC<IScrapedInputGroupProps> = (props) => {
  return (
    <TextField
      multiline
      minRows={3}
      placeholder={props.placeholder}
      value={props.isNew ? props.result.newValue : props.result.originalValue}
      InputProps={{
        readOnly: !props.isNew,
      }}
      onChange={(e) => {
        if (props.isNew && props.onChange) {
          props.onChange(e.target.value);
        }
      }}
      variant="outlined"
      fullWidth
      className="bg-secondary text-white border-secondary scene-description"
    />
  );
};

export const ScrapedTextAreaRow: React.FC<IScrapedInputGroupRowProps> = (
  props
) => {
  return (
    <ScrapeDialogRow
      title={props.title}
      field={props.field}
      result={props.result}
      originalField={
        <ScrapedTextArea
          placeholder={props.placeholder || props.title}
          result={props.result}
        />
      }
      newField={
        <ScrapedTextArea
          placeholder={props.placeholder || props.title}
          result={props.result}
          isNew
          onChange={(value) =>
            props.onChange(props.result.cloneWithValue(value))
          }
        />
      }
      onChange={props.onChange}
    />
  );
};

interface IScrapedImageProps {
  isNew?: boolean;
  className?: string;
  placeholder?: string;
  result: ScrapeResult<string>;
}

const ScrapedImage: React.FC<IScrapedImageProps> = (props) => {
  const value = props.isNew
    ? props.result.newValue
    : props.result.originalValue;

  if (!value) {
    return <></>;
  }

  return (
    <img className={props.className} src={value} alt={props.placeholder} />
  );
};

interface IScrapedImageRowProps {
  title: string;
  field: string;
  className?: string;
  result: ScrapeResult<string>;
  onChange: (value: ScrapeResult<string>) => void;
}

export const ScrapedImageRow: React.FC<IScrapedImageRowProps> = (props) => {
  return (
    <ScrapeDialogRow
      title={props.title}
      field={props.field}
      result={props.result}
      originalField={
        <ScrapedImage
          result={props.result}
          className={props.className}
          placeholder={props.title}
        />
      }
      newField={
        <ScrapedImage
          result={props.result}
          className={props.className}
          placeholder={props.title}
          isNew
        />
      }
      onChange={props.onChange}
    />
  );
};

interface IScrapedImagesRowProps {
  title: string;
  field: string;
  className?: string;
  result: ScrapeResult<string>;
  images: string[];
  onChange: (value: ScrapeResult<string>) => void;
}

export const ScrapedImagesRow: React.FC<IScrapedImagesRowProps> = (props) => {
  const [imageIndex, setImageIndex] = useState(0);

  function onSetImageIndex(newIdx: number) {
    const ret = props.result.cloneWithValue(props.images[newIdx]);
    props.onChange(ret);
    setImageIndex(newIdx);
  }

  return (
    <ScrapeDialogRow
      title={props.title}
      field={props.field}
      result={props.result}
      originalField={
        <ScrapedImage
          result={props.result}
          className={props.className}
          placeholder={props.title}
        />
      }
      newField={
        <div className="image-selection-parent">
          <ImageSelector
            imageClassName={props.className}
            images={props.images}
            imageIndex={imageIndex}
            setImageIndex={onSetImageIndex}
          />
        </div>
      }
      onChange={props.onChange}
    />
  );
};

interface IScrapedCountryRowProps {
  title: string;
  field: string;
  result: ScrapeResult<string>;
  onChange: (value: ScrapeResult<string>) => void;
  locked?: boolean;
  locale?: string;
}

export const ScrapedCountryRow: React.FC<IScrapedCountryRowProps> = ({
  title,
  field,
  result,
  onChange,
  locked,
  locale,
}) => (
  <ScrapeDialogRow
    title={title}
    field={field}
    result={result}
    originalField={
      <TextField
        value={
          getCountries(locale).find((c) => c.value === result.originalValue)
            ?.label ?? result.originalValue
        }
        InputProps={{
          readOnly: true
        }}
        variant="outlined"
        size="small"
        fullWidth
        className="bg-secondary text-white border-secondary"
      />
    }
    newField={
      <CountrySelect
        value={result.newValue}
        disabled={locked}
        onChange={(value) => {
          if (onChange) {
            onChange(result.cloneWithValue(value));
          }
        }}
        showFlag={false}
        isClearable={false}
        className="flex-grow-1"
      />
    }
    onChange={onChange}
  />
);
