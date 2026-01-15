import React from "react";
import { useIntl } from "react-intl";
import { Button, TextField, Box, InputAdornment, IconButton } from "@mui/material";
import { Icon } from "./Icon";
import { FormikHandlers } from "formik";
import { faFileDownload } from "@fortawesome/free-solid-svg-icons";
import {
  IStringListInputProps,
  StringInput,
  StringListInput,
} from "./StringListInput";

interface IProps {
  value: string;
  name: string;
  onChange: FormikHandlers["handleChange"];
  onBlur: FormikHandlers["handleBlur"];
  onScrapeClick(): void;
  urlScrapable(url: string): boolean;
  isInvalid?: boolean;
}

export const URLField: React.FC<IProps> = (props: IProps) => {
  const intl = useIntl();

  return (
    <Box className="mr-2 flex-grow-1" sx={{ display: 'flex', gap: 1 }}>
      <TextField
        className="text-input"
        placeholder={intl.formatMessage({ id: "url" })}
        value={props.value}
        name={props.name}
        onChange={props.onChange}
        onBlur={props.onBlur}
        error={props.isInvalid}
        size="small"
        fullWidth
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                className="scrape-url-button text-input"
                onClick={props.onScrapeClick}
                disabled={!props.value || !props.urlScrapable(props.value)}
                title={intl.formatMessage({ id: "actions.scrape" })}
                size="small"
              >
                <Icon icon={faFileDownload} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );
};

interface IURLListProps extends IStringListInputProps {
  onScrapeClick?: (url: string) => void;
  urlScrapable?: (url: string) => boolean;
}

export const URLListInput: React.FC<IURLListProps> = (
  listProps: IURLListProps
) => {
  const intl = useIntl();
  const { onScrapeClick, urlScrapable } = listProps;
  return (
    <StringListInput
      {...listProps}
      placeholder={intl.formatMessage({ id: "url" })}
      inputComponent={StringInput}
      appendComponent={(props) => {
        if (!onScrapeClick || !urlScrapable) {
          return <></>;
        }

        return (
          <IconButton
            className="scrape-url-button text-input"
            onClick={() => onScrapeClick(props.value)}
            disabled={!props.value || !urlScrapable(props.value)}
            title={intl.formatMessage({ id: "actions.scrape" })}
            size="small"
          >
            <Icon icon={faFileDownload} />
          </IconButton>
        );
      }}
    />
  );
};
