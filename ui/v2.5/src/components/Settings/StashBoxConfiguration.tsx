import React, { useRef, useState } from "react";
import { Button, TextField, Box, Typography } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { SettingSection } from "./SettingSection";
import * as GQL from "src/core/generated-graphql";
import { SettingModal } from "./Inputs";

export interface IStashBoxModal {
  value: GQL.StashBoxInput;
  close: (v?: GQL.StashBoxInput) => void;
  modalProps?: any;
}

const defaultMaxRequestsPerMinute = 240;

export const StashBoxModal: React.FC<IStashBoxModal> = ({ value, close, modalProps }) => {
  const intl = useIntl();
  const endpoint = useRef<HTMLInputElement | null>(null);
  const apiKey = useRef<HTMLInputElement | null>(null);

  const [validate, { data, loading }] = GQL.useValidateStashBoxLazyQuery({
    fetchPolicy: "network-only",
  });

  const handleValidate = () => {
    validate({
      variables: {
        input: {
          endpoint: endpoint.current?.value ?? "",
          api_key: apiKey.current?.value ?? "",
          name: "test",
        },
      },
    });
  };

  return (
    <SettingModal<GQL.StashBoxInput>
      headingID="config.stashbox.title"
      value={value}
      renderField={(v, setValue) => (
        <>
          <Box id="stashbox-name" sx={{ mb: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              {intl.formatMessage({
                id: "config.stashbox.name",
              })}
            </Typography>
            <TextField
              placeholder={intl.formatMessage({ id: "config.stashbox.name" })}
              fullWidth
              variant="outlined"
              className="stash-box-name"
              value={v?.name}
              error={!((v?.name?.length ?? 0) > 0)}
              onChange={(e) =>
                setValue({ ...v!, name: e.target.value })
              }
            />
          </Box>

          <Box id="stashbox-endpoint" sx={{ mb: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              {intl.formatMessage({
                id: "config.stashbox.graphql_endpoint",
              })}
            </Typography>
            <TextField
              placeholder={intl.formatMessage({
                id: "config.stashbox.graphql_endpoint",
              })}
              fullWidth
              variant="outlined"
              className="stash-box-endpoint"
              value={v?.endpoint}
              error={!((v?.endpoint?.length ?? 0) > 0)}
              onChange={(e) =>
                setValue({ ...v!, endpoint: e.target.value.trim() })
              }
              inputRef={endpoint}
            />
          </Box>

          <Box id="stashbox-apikey" sx={{ mb: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              {intl.formatMessage({
                id: "config.stashbox.api_key",
              })}
            </Typography>
            <TextField
              placeholder={intl.formatMessage({
                id: "config.stashbox.api_key",
              })}
              fullWidth
              variant="outlined"
              className="stash-box-apikey"
              value={v?.api_key}
              error={!((v?.api_key?.length ?? 0) > 0)}
              onChange={(e) =>
                setValue({ ...v!, api_key: e.target.value.trim() })
              }
              inputRef={apiKey}
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <Button
              disabled={loading}
              onClick={handleValidate}
              sx={{ mr: 3 }}
              variant="contained"
            >
              Test Credentials
            </Button>
            {data && (
              <Typography
                component="b"
                color={data.validateStashBoxCredentials?.valid ? "success.main" : "error.main"}
              >
                {data.validateStashBoxCredentials?.status}
              </Typography>
            )}
          </Box>

          <Box id="stashbox-max-requests-per-minute" sx={{ mb: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              {intl.formatMessage({
                id: "config.stashbox.max_requests_per_minute",
              })}
            </Typography>
            <TextField
              placeholder={intl.formatMessage({
                id: "config.stashbox.max_requests_per_minute",
              })}
              fullWidth
              variant="outlined"
              value={v?.max_requests_per_minute ?? defaultMaxRequestsPerMinute}
              error={!((v?.max_requests_per_minute ?? defaultMaxRequestsPerMinute) >= 0)}
              type="number"
              onChange={(e) =>
                setValue({
                  ...v!,
                  max_requests_per_minute: parseInt(e.target.value),
                })
              }
            />
            <div className="sub-heading">
              <FormattedMessage
                id="config.stashbox.max_requests_per_minute_description"
                values={{ defaultValue: defaultMaxRequestsPerMinute }}
              />
            </div>
          </Box>
        </>
      )}
      close={close}
      modalProps={modalProps}
    />
  );
};

interface IStashBoxSetting {
  value: GQL.StashBoxInput[];
  onChange: (v: GQL.StashBoxInput[]) => void;
  modalProps?: any;
}

export const StashBoxSetting: React.FC<IStashBoxSetting> = ({
  value,
  onChange,
  modalProps
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | undefined>();

  function onEdit(index: number) {
    setEditingIndex(index);
  }

  function onDelete(index: number) {
    onChange(value.filter((v, i) => i !== index));
  }

  function onNew() {
    setIsCreating(true);
  }

  return (
    <SettingSection
      id="stash-boxes"
      headingID="config.stashbox.title"
      subHeadingID="config.stashbox.description"
    >
      {isCreating ? (
        <StashBoxModal
          value={{
            endpoint: "",
            api_key: "",
            name: "",
          }}
          close={(v) => {
            if (v) onChange([...value, v]);
            setIsCreating(false);
          }}
          modalProps={modalProps}
        />
      ) : undefined}

      {editingIndex !== undefined ? (
        <StashBoxModal
          value={value[editingIndex]}
          close={(v) => {
            if (v)
              onChange(
                value.map((vv, index) => {
                  if (index === editingIndex) {
                    return v;
                  }
                  return vv;
                })
              );
            setEditingIndex(undefined);
          }}
          modalProps={modalProps}
        />
      ) : undefined}

      {value.map((b, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={index} className="setting">
          <div>
            <h3>{b.name ?? `#${index}`}</h3>
            <div className="value">{b.endpoint ?? ""}</div>
          </div>
          <div>
            <Button onClick={() => onEdit(index)} variant="contained" sx={{ mr: 1 }}>
              <FormattedMessage id="actions.edit" />
            </Button>
            <Button variant="contained" color="error" onClick={() => onDelete(index)}>
              <FormattedMessage id="actions.delete" />
            </Button>
          </div>
        </div>
      ))}
      <div className="setting">
        <div />
        <div>
          <Button onClick={() => onNew()} variant="contained">
            <FormattedMessage id="actions.add" />
          </Button>
        </div>
      </div>
    </SettingSection>
  );
};
