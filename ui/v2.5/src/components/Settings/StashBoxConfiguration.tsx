import React, { useRef, useState } from "react";
import {
  Button,
  TextField,
  Box,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Stack,
} from "@mui/material";
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
  const resolvedModalProps = { maxWidth: "md", fullWidth: true, ...modalProps };
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
      modalProps={resolvedModalProps}
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

      {value.length > 0 && (
        <Box sx={{ overflowX: "auto", mb: 2 }}>
          <Table size="small" sx={{ minWidth: 500 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold", width: "25%" }}>
                  <FormattedMessage id="name" />
                </TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>
                  <FormattedMessage id="config.stashbox.endpoint" />
                </TableCell>
                <TableCell sx={{ fontWeight: "bold", width: "180px" }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {value.map((b, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <TableRow key={index} hover>
                  <TableCell sx={{ fontWeight: 500 }}>
                    {b.name ?? `#${index}`}
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      sx={{ color: "text.secondary", wordBreak: "break-all" }}
                    >
                      {b.endpoint ?? ""}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => onEdit(index)}
                      >
                        <FormattedMessage id="actions.edit" />
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={() => onDelete(index)}
                      >
                        <FormattedMessage id="actions.delete" />
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      <Box>
        <Button onClick={() => onNew()} variant="contained" size="small">
          <FormattedMessage id="actions.add" />
        </Button>
      </Box>
    </SettingSection>
  );
};
