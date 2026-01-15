import React, { Dispatch, useState } from "react";
import {
  Chip,
  Button,
  Paper,
  Collapse,
  TextField,
  Typography,
  Box,
  FormHelperText,
  MenuItem,
  Stack,
} from "@mui/material";
import { FormattedMessage } from "react-intl";
import { useConfigurationContext } from "src/hooks/Config";

import { ITaggerConfig } from "../constants";
import PerformerFieldSelector from "../PerformerFieldSelector";

interface IConfigProps {
  show: boolean;
  config: ITaggerConfig;
  setConfig: Dispatch<ITaggerConfig>;
}

const Config: React.FC<IConfigProps> = ({ show, config, setConfig }) => {
  const { configuration: stashConfig } = useConfigurationContext();
  const [showExclusionModal, setShowExclusionModal] = useState(false);

  const excludedFields = config.excludedPerformerFields ?? [];

  const handleInstanceSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedEndpoint = e.target.value;
    setConfig({
      ...config,
      selectedEndpoint,
    });
  };

  const stashBoxes = stashConfig?.general.stashBoxes ?? [];

  const handleFieldSelect = (fields: string[]) => {
    setConfig({ ...config, excludedPerformerFields: fields });
    setShowExclusionModal(false);
  };

  return (
    <>
      <Collapse in={show}>
        <Paper sx={{ p: 2, mt: 2 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Typography variant="h5" sx={{ width: '100%' }}>
              <FormattedMessage id="configuration" />
            </Typography>
            <Box sx={{ flexBasis: { xs: '100%', md: '48%' } }}>
              <Box mb={3}>
                <Typography variant="h6" gutterBottom>
                  <FormattedMessage id="performer_tagger.config.excluded_fields" />
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  {excludedFields.length > 0 ? (
                    excludedFields.map((f) => (
                      <Chip key={f} size="small" label={<FormattedMessage id={f} />} />
                    ))
                  ) : (
                    <Typography variant="body2" color="textSecondary">
                      <FormattedMessage id="performer_tagger.config.no_fields_are_excluded" />
                    </Typography>
                  )}
                </Stack>
                <FormHelperText>
                  <FormattedMessage id="performer_tagger.config.these_fields_will_not_be_changed_when_updating_performers" />
                </FormHelperText>
                <Button
                  onClick={() => setShowExclusionModal(true)}
                  variant="outlined"
                  sx={{ mt: 1 }}
                >
                  <FormattedMessage id="performer_tagger.config.edit_excluded_fields" />
                </Button>
              </Box>

              <Box mb={3}>
                <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 2 }}>
                  <Typography>
                    <FormattedMessage id="performer_tagger.config.active_stash-box_instance" />
                  </Typography>
                  <TextField
                    select
                    size="small"
                    value={config.selectedEndpoint || ""}
                    disabled={!stashBoxes.length}
                    onChange={handleInstanceSelect}
                    sx={{ minWidth: 250 }}
                  >
                    {!stashBoxes.length && (
                      <MenuItem value="">
                        <FormattedMessage id="performer_tagger.config.no_instances_found" />
                      </MenuItem>
                    )}
                    {stashConfig?.general.stashBoxes.map((i) => (
                      <MenuItem value={i.endpoint} key={i.endpoint}>
                        {i.endpoint}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </Box>
            </Box>
          </Box>
        </Paper>
      </Collapse>
      <PerformerFieldSelector
        show={showExclusionModal}
        onSelect={handleFieldSelect}
        excludedFields={excludedFields}
      />
    </>
  );
};

export default Config;
