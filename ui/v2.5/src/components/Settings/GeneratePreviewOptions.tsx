import React from "react";
import { useIntl } from "react-intl";
import { Box, Typography, TextField, FormHelperText } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { NumberField } from "src/utils/form";

export type VideoPreviewSettingsInput = Pick<
  GQL.ConfigGeneralInput,
  | "previewSegments"
  | "previewSegmentDuration"
  | "previewExcludeStart"
  | "previewExcludeEnd"
>;

interface IVideoPreviewInput {
  value: VideoPreviewSettingsInput;
  setValue: (v: VideoPreviewSettingsInput) => void;
}

export const VideoPreviewInput: React.FC<IVideoPreviewInput> = ({
  value,
  setValue,
}) => {
  const intl = useIntl();

  function set(v: Partial<VideoPreviewSettingsInput>) {
    setValue({
      ...value,
      ...v,
    });
  }

  const {
    previewSegments,
    previewSegmentDuration,
    previewExcludeStart,
    previewExcludeEnd,
  } = value;

  return (
    <Box>
      <Box id="preview-segments" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          {intl.formatMessage({
            id: "dialogs.scene_gen.preview_seg_count_head",
          })}
        </Typography>
        <NumberField
          className="text-input"
          value={previewSegments?.toString() ?? 1}
          min={1}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            set({
              previewSegments: Number.parseInt(
                e.currentTarget.value || "1",
                10
              ),
            })
          }
        />
        <FormHelperText>
          {intl.formatMessage({
            id: "dialogs.scene_gen.preview_seg_count_desc",
          })}
        </FormHelperText>
      </Box>

      <Box id="preview-segment-duration" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          {intl.formatMessage({
            id: "dialogs.scene_gen.preview_seg_duration_head",
          })}
        </Typography>
        <NumberField
          className="text-input"
          value={previewSegmentDuration?.toString() ?? 0}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            set({
              previewSegmentDuration: Number.parseFloat(
                e.currentTarget.value || "0"
              ),
            })
          }
        />
        <FormHelperText>
          {intl.formatMessage({
            id: "dialogs.scene_gen.preview_seg_duration_desc",
          })}
        </FormHelperText>
      </Box>

      <Box id="preview-exclude-start" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          {intl.formatMessage({
            id: "dialogs.scene_gen.preview_exclude_start_time_head",
          })}
        </Typography>
        <TextField
          fullWidth
          variant="outlined"
          className="text-input"
          value={previewExcludeStart ?? ""}
          onChange={(e) =>
            set({ previewExcludeStart: e.target.value })
          }
        />
        <FormHelperText>
          {intl.formatMessage({
            id: "dialogs.scene_gen.preview_exclude_start_time_desc",
          })}
        </FormHelperText>
      </Box>

      <Box id="preview-exclude-end" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          {intl.formatMessage({
            id: "dialogs.scene_gen.preview_exclude_end_time_head",
          })}
        </Typography>
        <TextField
          fullWidth
          variant="outlined"
          className="text-input"
          value={previewExcludeEnd ?? ""}
          onChange={(e) =>
            set({ previewExcludeEnd: e.target.value })
          }
        />
        <FormHelperText>
          {intl.formatMessage({
            id: "dialogs.scene_gen.preview_exclude_end_time_desc",
          })}
        </FormHelperText>
      </Box>
    </Box>
  );
};
