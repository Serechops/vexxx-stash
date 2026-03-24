import React, { Dispatch, useState } from "react";
import {
  Chip,
  Button,
  Paper,
  Collapse,
  Typography,
  Box,
  FormHelperText,
  Stack,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import { FormattedMessage } from "react-intl";

import { ITaggerConfig } from "../constants";
import StudioFieldSelector from "./StudioFieldSelector";

interface IConfigProps {
  show: boolean;
  config: ITaggerConfig;
  setConfig: Dispatch<ITaggerConfig>;
}

const Config: React.FC<IConfigProps> = ({ show, config, setConfig }) => {
  const [showExclusionModal, setShowExclusionModal] = useState(false);

  const excludedFields = config.excludedStudioFields ?? [];

  const handleFieldSelect = (fields: string[]) => {
    setConfig({ ...config, excludedStudioFields: fields });
    setShowExclusionModal(false);
  };

  return (
    <>
      <Collapse in={show}>
        <Paper sx={{ mt: 2, p: 2 }}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            <Typography variant="h5" sx={{ width: "100%" }}>
              <FormattedMessage id="configuration" />
            </Typography>
            <Box sx={{ flexBasis: { xs: "100%", md: "48%" } }}>
              <Box mb={3}>
                <FormControlLabel
                  control={
                    <Checkbox
                      id="create-parent"
                      checked={config.createParentStudios}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setConfig({
                          ...config,
                          createParentStudios: e.target.checked,
                        })
                      }
                    />
                  }
                  label={<FormattedMessage id="studio_tagger.config.create_parent_label" />}
                />
                <FormHelperText>
                  <FormattedMessage id="studio_tagger.config.create_parent_desc" />
                </FormHelperText>
              </Box>

              <Box mb={3}>
                <Typography variant="h6" gutterBottom>
                  <FormattedMessage id="studio_tagger.config.excluded_fields" />
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  {excludedFields.length > 0 ? (
                    excludedFields.map((f) => (
                      <Chip key={f} size="small" label={<FormattedMessage id={f} />} />
                    ))
                  ) : (
                    <Typography variant="body2" color="textSecondary">
                      <FormattedMessage id="studio_tagger.config.no_fields_are_excluded" />
                    </Typography>
                  )}
                </Stack>
                <FormHelperText>
                  <FormattedMessage id="studio_tagger.config.these_fields_will_not_be_changed_when_updating_studios" />
                </FormHelperText>
                <Button
                  onClick={() => setShowExclusionModal(true)}
                  variant="outlined"
                  sx={{ mt: 1 }}
                >
                  <FormattedMessage id="studio_tagger.config.edit_excluded_fields" />
                </Button>
              </Box>

            </Box>
          </Box>
        </Paper>
      </Collapse>
      <StudioFieldSelector
        show={showExclusionModal}
        onSelect={handleFieldSelect}
        excludedFields={excludedFields}
      />
    </>
  );
};

export default Config;
