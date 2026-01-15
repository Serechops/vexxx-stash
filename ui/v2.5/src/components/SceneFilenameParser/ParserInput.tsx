import React, { useState } from "react";
import {
  Button,
  TextField,
  Checkbox,
  FormControlLabel,
  Box,
  Stack,
  Typography,
  Grid,
  Menu,
  MenuItem,
  InputAdornment,
  Tooltip,
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { faQuestionCircle, faCaretDown } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "src/components/Shared/Icon";
import { ParserField } from "./ParserField";
import { ShowFields } from "./ShowFields";

const builtInRecipes = [
  {
    pattern: "{title}",
    ignoreWords: [],
    whitespaceCharacters: "",
    capitalizeTitle: false,
    description: "Filename",
  },
  {
    pattern: "{title}.{ext}",
    ignoreWords: [],
    whitespaceCharacters: "",
    capitalizeTitle: false,
    description: "Without extension",
  },
  {
    pattern: "{}.{yy}.{mm}.{dd}.{title}.XXX.{}.{ext}",
    ignoreWords: [],
    whitespaceCharacters: ".",
    capitalizeTitle: true,
    description: "",
  },
  {
    pattern: "{}.{yy}.{mm}.{dd}.{title}.{ext}",
    ignoreWords: [],
    whitespaceCharacters: ".",
    capitalizeTitle: true,
    description: "",
  },
  {
    pattern: "{title}.XXX.{}.{ext}",
    ignoreWords: [],
    whitespaceCharacters: ".",
    capitalizeTitle: true,
    description: "",
  },
  {
    pattern: "{}.{yy}.{mm}.{dd}.{title}.{i}.{ext}",
    ignoreWords: ["cz", "fr"],
    whitespaceCharacters: ".",
    capitalizeTitle: true,
    description: "Foreign language",
  },
];

export interface IParserInput {
  pattern: string;
  ignoreWords: string[];
  whitespaceCharacters: string;
  capitalizeTitle: boolean;
  page: number;
  pageSize: number;
  findClicked: boolean;
  ignoreOrganized: boolean;
}

interface IParserRecipe {
  pattern: string;
  ignoreWords: string[];
  whitespaceCharacters: string;
  capitalizeTitle: boolean;
  description: string;
}

interface IParserInputProps {
  input: IParserInput;
  onFind: (input: IParserInput) => void;
  onPageSizeChanged: (newSize: number) => void;
  showFields: Map<string, boolean>;
  setShowFields: (fields: Map<string, boolean>) => void;
}

export const ParserInput: React.FC<IParserInputProps> = (
  props: IParserInputProps
) => {
  const intl = useIntl();
  const [pattern, setPattern] = useState<string>(props.input.pattern);
  const [ignoreWords, setIgnoreWords] = useState<string>(
    props.input.ignoreWords.join(" ")
  );
  const [whitespaceCharacters, setWhitespaceCharacters] = useState<string>(
    props.input.whitespaceCharacters
  );
  const [capitalizeTitle, setCapitalizeTitle] = useState<boolean>(
    props.input.capitalizeTitle
  );
  const [ignoreOrganized, setIgnoreOrganized] = useState<boolean>(
    props.input.ignoreOrganized
  );

  const [fieldAnchorEl, setFieldAnchorEl] = useState<null | HTMLElement>(null);
  const [recipeAnchorEl, setRecipeAnchorEl] = useState<null | HTMLElement>(null);

  function onFind() {
    props.onFind({
      pattern,
      ignoreWords: ignoreWords.split(" "),
      whitespaceCharacters,
      capitalizeTitle,
      page: 1,
      pageSize: props.input.pageSize,
      findClicked: props.input.findClicked,
      ignoreOrganized,
    });
  }

  function setParserRecipe(recipe: IParserRecipe) {
    setPattern(recipe.pattern);
    setIgnoreWords(recipe.ignoreWords.join(" "));
    setWhitespaceCharacters(recipe.whitespaceCharacters);
    setCapitalizeTitle(recipe.capitalizeTitle);
    setRecipeAnchorEl(null);
  }

  const validFields = [new ParserField("", "Wildcard")].concat(
    ParserField.validFields
  );

  function addParserField(field: ParserField) {
    setPattern(pattern + field.getFieldPattern());
    setFieldAnchorEl(null);
  }

  const PAGE_SIZE_OPTIONS = ["20", "40", "60", "120", "250", "500", "1000"];

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={2} alignItems="center" mb={2}>
        <Grid size={{ xs: 12, sm: 2 }}>
          <Typography variant="subtitle1" component="label" htmlFor="filename-pattern">
            {intl.formatMessage({
              id: "config.tools.scene_filename_parser.filename_pattern",
            })}
          </Typography>
        </Grid>
        <Grid size={{ xs: 12, sm: 10 }}>
          <TextField
            id="filename-pattern"
            fullWidth
            variant="outlined"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Button
                      variant="contained"
                      color="secondary"
                      onClick={(e) => setFieldAnchorEl(e.currentTarget)}
                      endIcon={<Icon icon={faCaretDown} />}
                      sx={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                    >
                      {intl.formatMessage({
                        id: "config.tools.scene_filename_parser.add_field",
                      })}
                    </Button>
                  </InputAdornment>
                )
              }
            }}
          />
          <Menu
            anchorEl={fieldAnchorEl}
            open={Boolean(fieldAnchorEl)}
            onClose={() => setFieldAnchorEl(null)}
          >
            {validFields.map((item) => (
              <MenuItem key={item.field} onClick={() => addParserField(item)}>
                <Box display="flex" width="100%" justifyContent="space-between" gap={2}>
                  <Typography variant="body2">{item.field || "{}"}</Typography>
                  <Typography variant="caption" color="textSecondary">{item.helperText}</Typography>
                </Box>
              </MenuItem>
            ))}
          </Menu>
          <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block' }}>
            {intl.formatMessage({
              id: "config.tools.scene_filename_parser.escape_chars",
            })}
          </Typography>
        </Grid>
      </Grid>

      <Grid container spacing={2} alignItems="center" mb={2}>
        <Grid size={{ xs: 12, sm: 2 }}>
          <Typography variant="subtitle1" component="label" htmlFor="ignore-words">
            {intl.formatMessage({
              id: "config.tools.scene_filename_parser.ignored_words",
            })}{" "}
            <Tooltip title={intl.formatMessage({
              id: "config.tools.scene_filename_parser.ignore_words_help",
            })}>
              <span><Icon icon={faQuestionCircle} /></span>
            </Tooltip>
          </Typography>
        </Grid>
        <Grid size={{ xs: 12, sm: 10 }}>
          <TextField
            id="ignore-words"
            fullWidth
            variant="outlined"
            value={ignoreWords}
            onChange={(e) => setIgnoreWords(e.target.value)}
          />
          <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block' }}>
            {intl.formatMessage({
              id: "config.tools.scene_filename_parser.matches_with",
            })}
          </Typography>
        </Grid>
      </Grid>

      <Typography variant="h6" gutterBottom>{intl.formatMessage({ id: "title" })}</Typography>
      <Grid container spacing={2} alignItems="center" mb={2}>
        <Grid size={{ xs: 12, sm: 2 }}>
          <Typography variant="subtitle1" component="label" htmlFor="whitespace-characters">
            {intl.formatMessage({
              id: "config.tools.scene_filename_parser.whitespace_chars",
            })}
          </Typography>
        </Grid>
        <Grid size={{ xs: 12, sm: 10 }}>
          <TextField
            id="whitespace-characters"
            fullWidth
            variant="outlined"
            value={whitespaceCharacters}
            onChange={(e) => setWhitespaceCharacters(e.target.value)}
          />
          <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block' }}>
            {intl.formatMessage({
              id: "config.tools.scene_filename_parser.whitespace_chars_desc",
            })}
          </Typography>
        </Grid>
      </Grid>

      <Box mb={2}>
        <FormControlLabel
          control={
            <Checkbox
              id="capitalize-title"
              checked={capitalizeTitle}
              onChange={(e) => setCapitalizeTitle(e.target.checked)}
            />
          }
          label={intl.formatMessage({
            id: "config.tools.scene_filename_parser.capitalize_title",
          })}
        />
      </Box>

      <Box mb={2}>
        <FormControlLabel
          control={
            <Checkbox
              id="ignore-organized"
              checked={ignoreOrganized}
              onChange={(e) => setIgnoreOrganized(e.target.checked)}
            />
          }
          label={intl.formatMessage({
            id: "config.tools.scene_filename_parser.ignore_organized",
          })}
        />
      </Box>

      <Box mb={2}>
        <Button
          variant="contained"
          color="secondary"
          onClick={(e) => setRecipeAnchorEl(e.currentTarget)}
          endIcon={<Icon icon={faCaretDown} />}
        >
          {intl.formatMessage({
            id: "config.tools.scene_filename_parser.select_parser_recipe",
          })}
        </Button>
        <Menu
          anchorEl={recipeAnchorEl}
          open={Boolean(recipeAnchorEl)}
          onClose={() => setRecipeAnchorEl(null)}
        >
          {builtInRecipes.map((item) => (
            <MenuItem key={item.pattern} onClick={() => setParserRecipe(item)}>
              <Box display="flex" width="100%" justifyContent="space-between" gap={2}>
                <Typography variant="body2">{item.pattern}</Typography>
                <Typography variant="caption" color="textSecondary">{item.description}</Typography>
              </Box>
            </MenuItem>
          ))}
        </Menu>
      </Box>

      <Box mb={2}>
        <ShowFields
          fields={props.showFields}
          onShowFieldsChanged={(fields) => props.setShowFields(fields)}
        />
      </Box>

      <Stack direction="row" spacing={2} alignItems="center">
        <Button variant="contained" color="primary" onClick={onFind}>
          {intl.formatMessage({ id: "actions.find" })}
        </Button>

        <Box display="flex" alignItems="center">
          <Typography sx={{ mr: 1 }}>
            <FormattedMessage id="items_per_page" />:
          </Typography>
          <TextField
            select
            value={props.input.pageSize}
            onChange={(e) => props.onPageSizeChanged(parseInt(e.target.value, 10))}
            variant="outlined"
            size="small"
            sx={{ width: 80 }}
          >
            {PAGE_SIZE_OPTIONS.map((val) => (
              <MenuItem key={val} value={val}>
                {val}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </Stack>
    </Box>
  );
};
