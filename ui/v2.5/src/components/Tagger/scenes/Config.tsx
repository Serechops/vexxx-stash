import { faTimes } from "@fortawesome/free-solid-svg-icons";
import React, { useContext, useState } from "react";
import {
  Button,
  Chip,
  Paper,
  Collapse,
  TextField,
  Box,
  Typography,
  FormControlLabel,
  Checkbox,
  MenuItem,
  FormHelperText,
  Stack,
  InputAdornment,
  IconButton,
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";

import { Icon } from "src/components/Shared/Icon";
import { ParseMode, TagOperation } from "../constants";
import { TaggerStateContext } from "../context";
import { GenderEnum } from "src/core/generated-graphql";
import { genderList } from "src/utils/gender";

const Blacklist: React.FC<{
  list: string[];
  setList: (blacklist: string[]) => void;
}> = ({ list, setList }) => {
  const intl = useIntl();

  const [currentValue, setCurrentValue] = useState("");
  const [error, setError] = useState<string>();

  function addBlacklistItem() {
    if (!currentValue) return;

    // don't add duplicate items
    if (list.includes(currentValue)) {
      setError(
        intl.formatMessage({
          id: "component_tagger.config.errors.blacklist_duplicate",
        })
      );
      return;
    }

    // validate regex
    try {
      new RegExp(currentValue);
    } catch (e) {
      setError((e as SyntaxError).message);
      return;
    }

    setList([...list, currentValue]);

    setCurrentValue("");
  }

  function removeBlacklistItem(index: number) {
    const newBlacklist = [...list];
    newBlacklist.splice(index, 1);
    setList(newBlacklist);
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        <FormattedMessage id="component_tagger.config.blacklist_label" />
      </Typography>
      <Box mb={2}>
        <TextField
          fullWidth
          value={currentValue}
          onChange={(e) => {
            setCurrentValue(e.target.value);
            setError(undefined);
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              addBlacklistItem();
              e.preventDefault();
            }
          }}
          error={!!error}
          helperText={error}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <Button variant="contained" size="small" onClick={() => addBlacklistItem()}>
                    <FormattedMessage id="actions.add" />
                  </Button>
                </InputAdornment>
              )
            }
          }}
        />
      </Box>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
        {intl.formatMessage(
          { id: "component_tagger.config.blacklist_desc" },
          { chars_require_escape: <code>[\\^$.|?*+()</code> }
        )}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {list.map((item, index) => (
          <Chip
            key={item}
            label={item.toString()}
            onDelete={() => removeBlacklistItem(index)}
            deleteIcon={<Icon icon={faTimes} />}
            sx={{ mb: 1 }}
          />
        ))}
      </Stack>
    </Box>
  );
};

interface IConfigProps {
  show: boolean;
}

const Config: React.FC<IConfigProps> = ({ show }) => {
  const { config, setConfig } = useContext(TaggerStateContext);
  const intl = useIntl();

  function renderGenderCheckbox(gender: GenderEnum) {
    const performerGenders = config.performerGenders || genderList.slice();
    return (
      <FormControlLabel
        key={gender}
        control={
          <Checkbox
            checked={performerGenders.includes(gender)}
            onChange={(e) => {
              const isChecked = e.target.checked;
              setConfig({
                ...config,
                performerGenders: isChecked
                  ? [...performerGenders, gender]
                  : performerGenders.filter((g) => g !== gender),
              });
            }}
            size="small"
          />
        }
        label={<FormattedMessage id={`gender_types.${gender}`} />}
      />
    );
  }

  return (
    <Collapse in={show}>
      <Paper sx={{ p: 2, mt: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          <Typography variant="h5" sx={{ width: '100%' }}>
            <FormattedMessage id="configuration" />
          </Typography>
          <Box sx={{ flexBasis: { xs: '100%', md: '48%' } }}>
            <Box mb={3}>
              <Typography variant="subtitle1" gutterBottom>
                <FormattedMessage id="component_tagger.config.performer_genders.heading" />
              </Typography>
              <Stack direction="row" flexWrap="wrap">
                {genderList.map(renderGenderCheckbox)}
              </Stack>
              <FormHelperText>
                <FormattedMessage id="component_tagger.config.performer_genders.description" />
              </FormHelperText>
            </Box>

            <Box mb={3}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={config.setCoverImage}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        setCoverImage: e.target.checked,
                      })
                    }
                  />
                }
                label={<FormattedMessage id="component_tagger.config.set_cover_label" />}
              />
              <FormHelperText>
                <FormattedMessage id="component_tagger.config.set_cover_desc" />
              </FormHelperText>
            </Box>

            <Box mb={3}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={config.setTags}
                      onChange={(e) =>
                        setConfig({ ...config, setTags: e.target.checked })
                      }
                    />
                  }
                  label={<FormattedMessage id="component_tagger.config.set_tag_label" />}
                />
                <TextField
                  select
                  size="small"
                  value={config.tagOperation}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      tagOperation: e.target.value as TagOperation,
                    })
                  }
                  disabled={!config.setTags}
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="merge">
                    {intl.formatMessage({ id: "actions.merge" })}
                  </MenuItem>
                  <MenuItem value="overwrite">
                    {intl.formatMessage({ id: "actions.overwrite" })}
                  </MenuItem>
                </TextField>
              </Stack>
              <FormHelperText>
                <FormattedMessage id="component_tagger.config.set_tag_desc" />
              </FormHelperText>
            </Box>

            <Box mb={3}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Typography>
                  <FormattedMessage id="component_tagger.config.query_mode_label" />:
                </Typography>
                <TextField
                  select
                  size="small"
                  value={config.mode}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      mode: e.target.value as ParseMode,
                    })
                  }
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="auto">
                    {intl.formatMessage({
                      id: "component_tagger.config.query_mode_auto",
                    })}
                  </MenuItem>
                  <MenuItem value="filename">
                    {intl.formatMessage({
                      id: "component_tagger.config.query_mode_filename",
                    })}
                  </MenuItem>
                  <MenuItem value="dir">
                    {intl.formatMessage({
                      id: "component_tagger.config.query_mode_dir",
                    })}
                  </MenuItem>
                  <MenuItem value="path">
                    {intl.formatMessage({
                      id: "component_tagger.config.query_mode_path",
                    })}
                  </MenuItem>
                  <MenuItem value="metadata">
                    {intl.formatMessage({
                      id: "component_tagger.config.query_mode_metadata",
                    })}
                  </MenuItem>
                </TextField>
              </Stack>
              <FormHelperText>
                {intl.formatMessage({
                  id: `component_tagger.config.query_mode_${config.mode}_desc`,
                  defaultMessage: "Unknown query mode",
                })}
              </FormHelperText>
            </Box>

            <Box mb={3}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={config.markSceneAsOrganizedOnSave}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        markSceneAsOrganizedOnSave: e.target.checked,
                      })
                    }
                  />
                }
                label={<FormattedMessage id="component_tagger.config.mark_organized_label" />}
              />
              <FormHelperText>
                <FormattedMessage id="component_tagger.config.mark_organized_desc" />
              </FormHelperText>
            </Box>
          </Box>
          <Box sx={{ flexBasis: { xs: '100%', md: '48%' } }}>
            <Blacklist
              list={config.blacklist}
              setList={(blacklist) => setConfig({ ...config, blacklist })}
            />
          </Box>
        </Box>
      </Paper>
    </Collapse>
  );
};

export default Config;
