import React, { useMemo, useState } from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
  Box,
} from "@mui/material";
import { FormattedMessage, FormattedTime } from "react-intl";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import { ExternalLink } from "src/components/Shared/ExternalLink";
import { DeleteFilesDialog } from "src/components/Shared/DeleteFilesDialog";
import * as GQL from "src/core/generated-graphql";
import { mutateGallerySetPrimaryFile } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import TextUtils from "src/utils/text";

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

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

  const labelSx = {
    color: "text.secondary",
    width: "1%",
    whiteSpace: "nowrap",
    border: 0,
    py: 0.5,
    pl: 0,
    pr: 2,
  } as const;

  const valueSx = { border: 0, py: 0.5 } as const;

  return (
    <div>
      {props.primary && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          <FormattedMessage id="primary_file" />
        </Typography>
      )}
      <Table size="small">
        <TableBody>
          {checksum && (
            <TableRow>
              <TableCell sx={labelSx}>
                <FormattedMessage id="media_info.checksum" />
              </TableCell>
              <TableCell sx={valueSx}>
                <TruncatedText text={checksum.value} />
              </TableCell>
            </TableRow>
          )}
          {props.file && (
            <TableRow>
              <TableCell sx={labelSx}>
                <FormattedMessage id="file_mod_time" />
              </TableCell>
              <TableCell sx={valueSx}>
                <FormattedTime
                  dateStyle="medium"
                  timeStyle="medium"
                  value={props.file.mod_time ?? 0}
                />
              </TableCell>
            </TableRow>
          )}
          <TableRow>
            <TableCell sx={labelSx}>
              <FormattedMessage id={id} />
            </TableCell>
            <TableCell sx={{ ...valueSx, wordBreak: "break-all" }}>
              <ExternalLink href={`file://${path}`}>
                {`file://${path}`}
              </ExternalLink>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {props.ofMany && props.onSetPrimaryFile && !props.primary && (
        <Box display="flex" gap={1} flexWrap="wrap">
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
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
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
      {props.gallery.urls && props.gallery.urls.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            <FormattedMessage id="urls" />
          </Typography>
          <Divider sx={{ mb: 1 }} />
          <Box sx={{ wordBreak: "break-all" }}>
            {props.gallery.urls.map((url, i) => (
              <Box key={i}>
                <ExternalLink href={url}>{url}</ExternalLink>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {filesPanel}
    </>
  );
};
