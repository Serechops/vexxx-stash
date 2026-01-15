import React, { useMemo, useState } from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  Typography,
  Box,
} from "@mui/material";
import { FormattedMessage, FormattedTime } from "react-intl";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import { DeleteFilesDialog } from "src/components/Shared/DeleteFilesDialog";
import * as GQL from "src/core/generated-graphql";
import { mutateGallerySetPrimaryFile } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import TextUtils from "src/utils/text";
import { TextField, URLField, URLsField } from "src/utils/field";
import { Icon } from "src/components/Shared/Icon";
import { faAngleDown } from "@fortawesome/free-solid-svg-icons";

interface IFileInfoPanelProps {
  folder?: Pick<GQL.Folder, "id" | "path">;
  file?: GQL.GalleryFileDataFragment;
  primary?: boolean;
  ofMany?: boolean;
  onSetPrimaryFile?: () => void;
  onDeleteFile?: () => void;
  loading?: boolean;
}

const FileInfoPanel: React.FC<IFileInfoPanelProps> = (
  props: IFileInfoPanelProps
) => {
  const checksum = props.file?.fingerprints.find((f) => f.type === "md5");
  const path = props.folder ? props.folder.path : props.file?.path ?? "";
  const id = props.folder ? "folder" : "path";

  return (
    <div>
      <dl className="container gallery-file-info details-list">
        {props.primary && (
          <>
            <dt></dt>
            <dd className="primary-file">
              <FormattedMessage id="primary_file" />
            </dd>
          </>
        )}
        <TextField id="media_info.checksum" value={checksum?.value} truncate />
        <URLField
          id={id}
          url={`file://${path}`}
          value={`file://${path}`}
          truncate
        />
        {props.file && (
          <TextField id="file_mod_time">
            <FormattedTime
              dateStyle="medium"
              timeStyle="medium"
              value={props.file.mod_time ?? 0}
            />
          </TextField>
        )}
      </dl>
      {props.ofMany && props.onSetPrimaryFile && !props.primary && (
        <Box sx={{ "& > button": { mr: 1 } }}>
          <Button
            className="edit-button"
            disabled={props.loading}
            onClick={props.onSetPrimaryFile}
          >
            <FormattedMessage id="actions.make_primary" />
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={props.loading}
            onClick={props.onDeleteFile}
          >
            <FormattedMessage id="actions.delete_file" />
          </Button>
        </Box>
      )}
    </div>
  );
};
interface IGalleryFileInfoPanelProps {
  gallery: GQL.GalleryDataFragment;
}

export const GalleryFileInfoPanel: React.FC<IGalleryFileInfoPanelProps> = (
  props: IGalleryFileInfoPanelProps
) => {
  const Toast = useToast();

  const [loading, setLoading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<
    GQL.GalleryFileDataFragment | undefined
  >();

  const filesPanel = useMemo(() => {
    if (props.gallery.folder) {
      return <FileInfoPanel folder={props.gallery.folder} />;
    }

    if (props.gallery.files.length === 0) {
      return <></>;
    }

    if (props.gallery.files.length === 1) {
      return <FileInfoPanel file={props.gallery.files[0]} />;
    }

    async function onSetPrimaryFile(fileID: string) {
      try {
        setLoading(true);
        await mutateGallerySetPrimaryFile(props.gallery.id, fileID);
      } catch (e) {
        Toast.error(e);
      } finally {
        setLoading(false);
      }
    }

    return (
      <div>
        {deletingFile && (
          <DeleteFilesDialog
            onClose={() => setDeletingFile(undefined)}
            selected={[deletingFile]}
          />
        )}
        {props.gallery.files.map((file, index) => (
          <Accordion key={file.id} defaultExpanded={index === 0}>
            <AccordionSummary expandIcon={<Icon icon={faAngleDown} />}>
              <Typography>
                <TruncatedText text={TextUtils.fileNameFromPath(file.path)} />
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box sx={{ width: "100%" }}>
                <FileInfoPanel
                  file={file}
                  primary={index === 0}
                  ofMany
                  onSetPrimaryFile={() => onSetPrimaryFile(file.id)}
                  loading={loading}
                  onDeleteFile={() => setDeletingFile(file)}
                />
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}
      </div>
    );
  }, [props.gallery, loading, Toast, deletingFile]);

  return (
    <>
      <dl className="container gallery-file-info details-list">
        <URLsField id="urls" urls={props.gallery.urls} truncate />
      </dl>

      {filesPanel}
    </>
  );
};
