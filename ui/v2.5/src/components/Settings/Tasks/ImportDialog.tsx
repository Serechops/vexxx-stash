import React, { useState } from "react";
import { Box, FormControl, InputLabel, Select, MenuItem, Typography } from "@mui/material";
import { mutateImportObjects } from "src/core/StashService";
import { ModalComponent } from "src/components/Shared/Modal";
import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";
import { useIntl } from "react-intl";
import { faPencilAlt } from "@fortawesome/free-solid-svg-icons";

interface IImportDialogProps {
  onClose: () => void;
}

export const ImportDialog: React.FC<IImportDialogProps> = (
  props: IImportDialogProps
) => {
  const [duplicateBehaviour, setDuplicateBehaviour] = useState<string>(
    duplicateHandlingToString(GQL.ImportDuplicateEnum.Ignore)
  );

  const [missingRefBehaviour, setMissingRefBehaviour] = useState<string>(
    missingRefHandlingToString(GQL.ImportMissingRefEnum.Fail)
  );

  const [file, setFile] = useState<File | undefined>();

  // Network state
  const [isRunning, setIsRunning] = useState(false);

  const intl = useIntl();
  const Toast = useToast();

  function duplicateHandlingToString(
    value: GQL.ImportDuplicateEnum | undefined
  ) {
    switch (value) {
      case GQL.ImportDuplicateEnum.Fail:
        return "Fail";
      case GQL.ImportDuplicateEnum.Ignore:
        return "Ignore";
      case GQL.ImportDuplicateEnum.Overwrite:
        return "Overwrite";
    }
    return "Ignore";
  }

  function translateDuplicateHandling(value: string) {
    switch (value) {
      case "Fail":
        return GQL.ImportDuplicateEnum.Fail;
      case "Ignore":
        return GQL.ImportDuplicateEnum.Ignore;
      case "Overwrite":
        return GQL.ImportDuplicateEnum.Overwrite;
    }

    return GQL.ImportDuplicateEnum.Ignore;
  }

  function missingRefHandlingToString(
    value: GQL.ImportMissingRefEnum | undefined
  ) {
    switch (value) {
      case GQL.ImportMissingRefEnum.Fail:
        return "Fail";
      case GQL.ImportMissingRefEnum.Ignore:
        return "Ignore";
      case GQL.ImportMissingRefEnum.Create:
        return "Create";
    }
    return "Fail";
  }

  function translateMissingRefHandling(value: string) {
    switch (value) {
      case "Fail":
        return GQL.ImportMissingRefEnum.Fail;
      case "Ignore":
        return GQL.ImportMissingRefEnum.Ignore;
      case "Create":
        return GQL.ImportMissingRefEnum.Create;
    }

    return GQL.ImportMissingRefEnum.Fail;
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (
      event.target.validity.valid &&
      event.target.files &&
      event.target.files.length > 0
    ) {
      setFile(event.target.files[0]);
    }
  }

  async function onImport() {
    if (!file) return;

    try {
      setIsRunning(true);
      await mutateImportObjects({
        duplicateBehaviour: translateDuplicateHandling(duplicateBehaviour),
        missingRefBehaviour: translateMissingRefHandling(missingRefBehaviour),
        file,
      });
      setIsRunning(false);
      Toast.success(intl.formatMessage({ id: "Import Started..." }));
    } catch (e) {
      Toast.error(e);
    } finally {
      props.onClose();
    }
  }

  return (
    <ModalComponent
      show
      icon={faPencilAlt}
      header={intl.formatMessage({ id: "actions.import" })}
      accept={{
        onClick: () => {
          onImport();
        },
        text: intl.formatMessage({ id: "actions.import" }),
      }}
      cancel={{
        onClick: () => props.onClose(),
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "secondary",
      }}
      disabled={!file}
      isRunning={isRunning}
    >
      <Box className="dialog-container">
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>Import zip file</Typography>
          <input
            id="import-file"
            type="file"
            accept=".zip"
            onChange={onFileChange}
            style={{ width: '100%' }}
          />
        </Box>
        <Box sx={{ mb: 3 }}>
          <FormControl fullWidth variant="outlined">
            <InputLabel id="duplicate-handling-label">Duplicate object handling</InputLabel>
            <Select
              labelId="duplicate-handling-label"
              value={duplicateBehaviour}
              onChange={(e) => setDuplicateBehaviour(e.target.value as string)}
              label="Duplicate object handling"
            >
              {Object.values(GQL.ImportDuplicateEnum).map((p) => (
                <MenuItem key={p} value={p}>{duplicateHandlingToString(p)}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        <Box sx={{ mb: 3 }}>
          <FormControl fullWidth variant="outlined">
            <InputLabel id="missing-ref-handling-label">Missing reference handling</InputLabel>
            <Select
              labelId="missing-ref-handling-label"
              value={missingRefBehaviour}
              onChange={(e) => setMissingRefBehaviour(e.target.value as string)}
              label="Missing reference handling"
            >
              {Object.values(GQL.ImportMissingRefEnum).map((p) => (
                <MenuItem key={p} value={p}>{missingRefHandlingToString(p)}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Box>
    </ModalComponent>
  );
};
