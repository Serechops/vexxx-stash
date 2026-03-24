import React, { useState } from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  Box,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { FormattedMessage, FormattedTime } from "react-intl";
import { Link } from "react-router-dom";
import { ExternalLink } from "src/components/Shared/ExternalLink";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import { DeleteFilesDialog } from "src/components/Shared/DeleteFilesDialog";
import * as GQL from "src/core/generated-graphql";
import { mutateImageSetPrimaryFile } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import TextUtils from "src/utils/text";
import { FileSize } from "src/components/Shared/FileSize";
import NavUtils from "src/utils/navigation";

interface IFileInfoPanelProps {
  file: GQL.ImageFileDataFragment | GQL.VideoFileDataFragment;
  primary?: boolean;
  ofMany?: boolean;
  onSetPrimaryFile?: () => void;
  onDeleteFile?: () => void;
  loading?: boolean;
}

const FileInfoPanel: React.FC<IFileInfoPanelProps> = (
  props: IFileInfoPanelProps
) => {
  const checksum = props.file.fingerprints.find((f) => f.type === "md5");
  const phash = props.file.fingerprints.find((f) => f.type === "phash");

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
    <Box>
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
          {phash && (
            <TableRow>
              <TableCell sx={labelSx}>
                <FormattedMessage id="media_info.phash" />
              </TableCell>
              <TableCell sx={valueSx}>
                <Link
                  to={NavUtils.makeImagesPHashMatchUrl(phash.value)}
                  target="_self"
                >
                  <TruncatedText text={phash.value} />
                </Link>
              </TableCell>
            </TableRow>
          )}
          <TableRow>
            <TableCell sx={labelSx}>
              <FormattedMessage id="filesize" />
            </TableCell>
            <TableCell sx={valueSx}>
              <FileSize size={props.file.size} />
            </TableCell>
          </TableRow>
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
          <TableRow>
            <TableCell sx={labelSx}>
              <FormattedMessage id="dimensions" />
            </TableCell>
            <TableCell sx={valueSx}>
              {`${props.file.width} x ${props.file.height}`}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={labelSx}>
              <FormattedMessage id="path" />
            </TableCell>
            <TableCell sx={{ ...valueSx, wordBreak: "break-all" }}>
              <ExternalLink href={`file://${props.file.path}`}>
                {`file://${props.file.path}`}
              </ExternalLink>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {props.ofMany && props.onSetPrimaryFile && !props.primary && (
        <Box display="flex" gap={1} flexWrap="wrap">
          <Button
            variant="outlined"
            className="edit-button"
            disabled={props.loading}
            onClick={props.onSetPrimaryFile}
          >
            <FormattedMessage id="actions.make_primary" />
          </Button>
          <Button
            variant="outlined"
            color="error"
            disabled={props.loading}
            onClick={props.onDeleteFile}
          >
            <FormattedMessage id="actions.delete_file" />
          </Button>
        </Box>
      )}
    </Box>
  );
};
interface IImageFileInfoPanelProps {
  image: GQL.ImageDataFragment;
}

export const ImageFileInfoPanel: React.FC<IImageFileInfoPanelProps> = (
  props: IImageFileInfoPanelProps
) => {
  const Toast = useToast();

  const [loading, setLoading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<
    GQL.ImageFileDataFragment | GQL.VideoFileDataFragment | undefined
  >();
  const [expanded, setExpanded] = useState<string | false>(props.image.visual_files[0]?.id || false);

  if (props.image.visual_files.length === 0) {
    return <></>;
  }

  if (props.image.visual_files.length === 1) {
    return (
      <>
        {props.image.urls && props.image.urls.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              <FormattedMessage id="urls" />
            </Typography>
            <Divider sx={{ mb: 1 }} />
            <Box sx={{ wordBreak: "break-all" }}>
              {props.image.urls.map((url, i) => (
                <Box key={i}>
                  <ExternalLink href={url}>{url}</ExternalLink>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <FileInfoPanel file={props.image.visual_files[0]} />
      </>
    );
  }

  async function onSetPrimaryFile(fileID: string) {
    try {
      setLoading(true);
      await mutateImageSetPrimaryFile(props.image.id, fileID);
    } catch (e) {
      Toast.error(e);
    } finally {
      setLoading(false);
    }
  }

  const handleChange = (panel: string) => (_event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  return (
    <div>
      {deletingFile && (
        <DeleteFilesDialog
          onClose={() => setDeletingFile(undefined)}
          selected={[deletingFile]}
        />
      )}
      {props.image.visual_files.map((file, index) => (
        <Accordion
          key={file.id}
          expanded={expanded === file.id}
          onChange={handleChange(file.id)}
          className="image-file-card"
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography>
              <TruncatedText text={TextUtils.fileNameFromPath(file.path)} />
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box width="100%">
              <FileInfoPanel
                file={file}
                primary={index === 0}
                ofMany
                onSetPrimaryFile={() => onSetPrimaryFile(file.id)}
                onDeleteFile={() => setDeletingFile(file)}
                loading={loading}
              />
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}
    </div>
  );
};
