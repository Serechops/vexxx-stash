import React, { useMemo, useState } from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Button,
  Chip,
  Table,
  TableBody,
  TableRow,
  TableCell,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  FormattedMessage,
  FormattedNumber,
  FormattedTime,
  useIntl,
} from "react-intl";
import { Link, useHistory } from "react-router-dom";
import { TruncatedText } from "src/components/Shared/TruncatedText";
import { ExternalLink } from "src/components/Shared/ExternalLink";
import { DeleteFilesDialog } from "src/components/Shared/DeleteFilesDialog";
import { ReassignFilesDialog } from "src/components/Shared/ReassignFilesDialog";
import * as GQL from "src/core/generated-graphql";
import { mutateSceneSetPrimaryFile } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import NavUtils from "src/utils/navigation";
import TextUtils from "src/utils/text";
import { StashIDPill } from "src/components/Shared/StashID";
import { PatchComponent } from "../../../patch";
import { FileSize } from "src/components/Shared/FileSize";

// Shared label/value row used in both the per-file and scene-level info tables
interface IInfoRowProps {
  labelId?: string;
  label?: React.ReactNode;
  children: React.ReactNode;
}

const InfoRow: React.FC<IInfoRowProps> = ({ labelId, label, children }) => (
  <TableRow>
    <TableCell
      sx={{
        color: "text.secondary",
        whiteSpace: "nowrap",
        width: "1%",
        pr: 2,
        py: 0.5,
        verticalAlign: "top",
      }}
    >
      {labelId ? <FormattedMessage id={labelId} /> : label}
    </TableCell>
    <TableCell sx={{ wordBreak: "break-all", py: 0.5 }}>
      {children}
    </TableCell>
  </TableRow>
);

interface IFileInfoPanelProps {
  sceneID: string;
  file: GQL.VideoFileDataFragment;
  primary?: boolean;
  ofMany?: boolean;
  onSetPrimaryFile?: () => void;
  onDeleteFile?: () => void;
  onReassign?: () => void;
  loading?: boolean;
}

const FileInfoPanel: React.FC<IFileInfoPanelProps> = (
  props: IFileInfoPanelProps
) => {
  const intl = useIntl();
  const history = useHistory();

  // TODO - generalise fingerprints
  const oshash = props.file.fingerprints.find((f) => f.type === "oshash");
  const phash = props.file.fingerprints.find((f) => f.type === "phash");
  const checksum = props.file.fingerprints.find((f) => f.type === "md5");

  function onSplit() {
    history.push(
      `/scenes/new?from_scene_id=${props.sceneID}&file_id=${props.file.id}`
    );
  }

  return (
    <Box>
      {props.primary && (
        <Chip
          label={<FormattedMessage id="primary_file" />}
          size="small"
          color="primary"
          sx={{ mb: 1 }}
        />
      )}
      <Table size="small">
        <TableBody>
          {oshash?.value && (
            <InfoRow labelId="media_info.hash">
              <TruncatedText text={oshash.value} />
            </InfoRow>
          )}
          {checksum?.value && (
            <InfoRow labelId="media_info.checksum">
              <TruncatedText text={checksum.value} />
            </InfoRow>
          )}
          {phash?.value && (
            <InfoRow
              label={
                <abbr title="Perceptual hash">
                  <FormattedMessage id="media_info.phash" />
                </abbr>
              }
            >
              <Link
                to={NavUtils.makeScenesPHashMatchUrl(phash.value)}
                target="_self"
              >
                <TruncatedText text={phash.value} />
              </Link>
            </InfoRow>
          )}
          <InfoRow labelId="filesize">
            <FileSize size={props.file.size} />
          </InfoRow>
          <InfoRow labelId="file_mod_time">
            <FormattedTime
              dateStyle="medium"
              timeStyle="medium"
              value={props.file.mod_time ?? 0}
            />
          </InfoRow>
          <InfoRow labelId="duration">
            {TextUtils.secondsToTimestamp(props.file.duration ?? 0)}
          </InfoRow>
          <InfoRow labelId="dimensions">
            {`${props.file.width} x ${props.file.height}`}
          </InfoRow>
          <InfoRow labelId="framerate">
            <FormattedMessage
              id="frames_per_second"
              values={{ value: intl.formatNumber(props.file.frame_rate ?? 0) }}
            />
          </InfoRow>
          <InfoRow labelId="bitrate">
            <FormattedMessage
              id="megabits_per_second"
              values={{
                value: intl.formatNumber(
                  (props.file.bit_rate ?? 0) / 1000000,
                  { maximumFractionDigits: 2 }
                ),
              }}
            />
          </InfoRow>
          {props.file.video_codec && (
            <InfoRow labelId="media_info.video_codec">
              <TruncatedText text={props.file.video_codec} />
            </InfoRow>
          )}
          {props.file.audio_codec && (
            <InfoRow labelId="media_info.audio_codec">
              <TruncatedText text={props.file.audio_codec} />
            </InfoRow>
          )}
          <InfoRow labelId="path">
            <ExternalLink href={`file://${props.file.path}`}>
              {props.file.path}
            </ExternalLink>
          </InfoRow>
        </TableBody>
      </Table>

      {props.ofMany && props.onSetPrimaryFile && !props.primary && (
        <Box sx={{ mt: 1.5, display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="outlined"
            disabled={props.loading}
            onClick={props.onSetPrimaryFile}
          >
            <FormattedMessage id="actions.make_primary" />
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={props.loading}
            onClick={props.onReassign}
          >
            <FormattedMessage id="actions.reassign" />
          </Button>
          <Button size="small" variant="outlined" onClick={onSplit}>
            <FormattedMessage id="actions.split" />
          </Button>
          <Button
            size="small"
            variant="contained"
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

interface ISceneFileInfoPanelProps {
  scene: GQL.SceneDataFragment;
}

const _SceneFileInfoPanel: React.FC<ISceneFileInfoPanelProps> = (
  props: ISceneFileInfoPanelProps
) => {
  const Toast = useToast();

  const [loading, setLoading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<GQL.VideoFileDataFragment>();
  const [reassigningFile, setReassigningFile] =
    useState<GQL.VideoFileDataFragment>();

  const filesPanel = useMemo(() => {
    if (props.scene.files.length === 0) {
      return;
    }

    if (props.scene.files.length === 1) {
      return (
        <FileInfoPanel sceneID={props.scene.id} file={props.scene.files[0]} />
      );
    }

    async function onSetPrimaryFile(fileID: string) {
      try {
        setLoading(true);
        await mutateSceneSetPrimaryFile(props.scene.id, fileID);
      } catch (e) {
        Toast.error(e);
      } finally {
        setLoading(false);
      }
    }

    return (
      <Box>
        {deletingFile && (
          <DeleteFilesDialog
            onClose={() => setDeletingFile(undefined)}
            selected={[{ id: deletingFile.id, path: deletingFile.path }]}
          />
        )}
        {reassigningFile && (
          <ReassignFilesDialog
            onClose={() => setReassigningFile(undefined)}
            selected={{ id: reassigningFile.id, path: reassigningFile.path }}
          />
        )}
        {props.scene.files.map((file, index) => (
          <Accordion key={file.id} defaultExpanded={index === 0}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <TruncatedText text={TextUtils.fileNameFromPath(file.path)} />
            </AccordionSummary>
            <AccordionDetails>
              <Box width="100%">
                <FileInfoPanel
                  sceneID={props.scene.id}
                  file={file}
                  primary={index === 0}
                  ofMany
                  onSetPrimaryFile={() => onSetPrimaryFile(file.id)}
                  onDeleteFile={() => setDeletingFile(file)}
                  onReassign={() => setReassigningFile(file)}
                  loading={loading}
                />
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>
    );
  }, [props.scene, loading, Toast, deletingFile, reassigningFile]);

  return (
    <>
      <Table size="small" sx={{ mb: filesPanel ? 2 : 0 }}>
        <TableBody>
          {props.scene.files.length > 0 && props.scene.paths.stream && (
            <InfoRow labelId="media_info.stream">
              <ExternalLink href={props.scene.paths.stream}>
                <TruncatedText text={props.scene.paths.stream} />
              </ExternalLink>
            </InfoRow>
          )}
          {props.scene.interactive && props.scene.paths.funscript && (
            <InfoRow label="Funscript">
              <ExternalLink href={props.scene.paths.funscript}>
                <TruncatedText text={props.scene.paths.funscript} />
              </ExternalLink>
            </InfoRow>
          )}
          {props.scene.interactive_speed && (
            <InfoRow labelId="media_info.interactive_speed">
              <FormattedNumber value={props.scene.interactive_speed} />
            </InfoRow>
          )}
          {props.scene.stash_ids.length > 0 && (
            <InfoRow labelId="stash_ids">
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {props.scene.stash_ids.map((stashID) => (
                  <StashIDPill
                    key={stashID.stash_id}
                    stashID={stashID}
                    linkType="scenes"
                  />
                ))}
              </Box>
            </InfoRow>
          )}
          {props.scene.urls && props.scene.urls.length > 0 && (
            <InfoRow labelId="urls">
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                {props.scene.urls.map((url, i) => (
                  <ExternalLink key={i} href={url}>
                    {url}
                  </ExternalLink>
                ))}
              </Box>
            </InfoRow>
          )}
        </TableBody>
      </Table>

      {filesPanel}
    </>
  );
};

export const SceneFileInfoPanel = PatchComponent(
  "SceneFileInfoPanel",
  _SceneFileInfoPanel
);
export default SceneFileInfoPanel;
