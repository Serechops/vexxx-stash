import React from "react";
import { FormHelperText, Box, Typography, Grid } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { FormattedMessage, useIntl } from "react-intl";
import { IScraperSource } from "./constants";
import { FieldOptionsList } from "./FieldOptions";
import { ThreeStateBoolean } from "./ThreeStateBoolean";
import { TagSelect } from "src/components/Shared/Select";

interface IOptionsEditor {
  options: GQL.IdentifyMetadataOptionsInput;
  setOptions: (s: GQL.IdentifyMetadataOptionsInput) => void;
  source?: IScraperSource;
  defaultOptions?: GQL.IdentifyMetadataOptionsInput;
  setEditingField: (v: boolean) => void;
}

export const OptionsEditor: React.FC<IOptionsEditor> = ({
  options,
  setOptions: setOptionsState,
  source,
  setEditingField,
  defaultOptions,
}) => {
  const intl = useIntl();

  function setOptions(v: Partial<GQL.IdentifyMetadataOptionsInput>) {
    setOptionsState({ ...options, ...v });
  }

  const headingID = !source
    ? "config.tasks.identify.default_options"
    : "config.tasks.identify.source_options";
  const checkboxProps = {
    allowUndefined: !!source,
  };

  function maybeRenderMultipleMatchesTag() {
    if (!options.skipMultipleMatches) {
      return;
    }

    return (
      <Grid container spacing={2} sx={{ ml: 3, mt: 1, mb: 0 }} alignItems="center">
        <Grid size={{ sm: 4 }} offset={{ sm: 1 }}>
          <Typography
            title={intl.formatMessage({
              id: "config.tasks.identify.tag_skipped_matches_tooltip",
            })}
          >
            <FormattedMessage id="config.tasks.identify.tag_skipped_matches" />
          </Typography>
        </Grid>
        <Grid size="grow">
          <TagSelect
            onSelect={(tags) =>
              setOptions({
                skipMultipleMatchTag: tags[0]?.id,
              })
            }
            ids={
              options.skipMultipleMatchTag ? [options.skipMultipleMatchTag] : []
            }
            noSelectionString="Select/create tag..."
            menuPortalTarget={document.body}
          />
        </Grid>
      </Grid>
    );
  }

  function maybeRenderPerformersTag() {
    if (!options.skipSingleNamePerformers) {
      return;
    }

    return (
      <Grid container spacing={2} sx={{ ml: 3, mt: 1, mb: 0 }} alignItems="center">
        <Grid size={{ sm: 4 }} offset={{ sm: 1 }}>
          <Typography
            title={intl.formatMessage({
              id: "config.tasks.identify.tag_skipped_performer_tooltip",
            })}
          >
            <FormattedMessage id="config.tasks.identify.tag_skipped_performers" />
          </Typography>
        </Grid>
        <Grid size="grow">
          <TagSelect
            onSelect={(tags) =>
              setOptions({
                skipSingleNamePerformerTag: tags[0]?.id,
              })
            }
            ids={
              options.skipSingleNamePerformerTag
                ? [options.skipSingleNamePerformerTag]
                : []
            }
            noSelectionString="Select/create tag..."
            menuPortalTarget={document.body}
          />
        </Grid>
      </Grid>
    );
  }

  return (
    <Box sx={{ mb: 0 }}>
      <Box>
        <Typography variant="h5" gutterBottom>
          <FormattedMessage
            id={headingID}
            values={{ source: source?.displayName }}
          />
        </Typography>
        {!source && (
          <FormHelperText sx={{ color: "text.secondary" }}>
            {intl.formatMessage({
              id: "config.tasks.identify.explicit_set_description",
            })}
          </FormHelperText>
        )}
      </Box>
      <Box sx={{ mb: 0 }}>
        <ThreeStateBoolean
          id="include-male-performers"
          value={
            options.includeMalePerformers === null
              ? undefined
              : options.includeMalePerformers
          }
          setValue={(v) =>
            setOptions({
              includeMalePerformers: v,
            })
          }
          label={intl.formatMessage({
            id: "config.tasks.identify.include_male_performers",
          })}
          defaultValue={defaultOptions?.includeMalePerformers ?? undefined}
          {...checkboxProps}
        />
        <ThreeStateBoolean
          id="set-cover-image"
          value={
            options.setCoverImage === null ? undefined : options.setCoverImage
          }
          setValue={(v) =>
            setOptions({
              setCoverImage: v,
            })
          }
          label={intl.formatMessage({
            id: "config.tasks.identify.set_cover_images",
          })}
          defaultValue={defaultOptions?.setCoverImage ?? undefined}
          {...checkboxProps}
        />
        <ThreeStateBoolean
          id="set-organized"
          value={
            options.setOrganized === null ? undefined : options.setOrganized
          }
          setValue={(v) =>
            setOptions({
              setOrganized: v,
            })
          }
          label={intl.formatMessage({
            id: "config.tasks.identify.set_organized",
          })}
          defaultValue={defaultOptions?.setOrganized ?? undefined}
          {...checkboxProps}
        />
      </Box>
      <ThreeStateBoolean
        id="skip-multiple-match"
        value={
          options.skipMultipleMatches === null
            ? undefined
            : options.skipMultipleMatches
        }
        setValue={(v) =>
          setOptions({
            skipMultipleMatches: v,
          })
        }
        label={intl.formatMessage({
          id: "config.tasks.identify.skip_multiple_matches",
        })}
        defaultValue={defaultOptions?.skipMultipleMatches ?? undefined}
        tooltip={intl.formatMessage({
          id: "config.tasks.identify.skip_multiple_matches_tooltip",
        })}
        {...checkboxProps}
      />
      {maybeRenderMultipleMatchesTag()}
      <ThreeStateBoolean
        id="skip-single-name-performers"
        value={
          options.skipSingleNamePerformers === null
            ? undefined
            : options.skipSingleNamePerformers
        }
        setValue={(v) =>
          setOptions({
            skipSingleNamePerformers: v,
          })
        }
        label={intl.formatMessage({
          id: "config.tasks.identify.skip_single_name_performers",
        })}
        defaultValue={defaultOptions?.skipSingleNamePerformers ?? undefined}
        tooltip={intl.formatMessage({
          id: "config.tasks.identify.skip_single_name_performers_tooltip",
        })}
        {...checkboxProps}
      />
      {maybeRenderPerformersTag()}

      <FieldOptionsList
        fieldOptions={options.fieldOptions ?? undefined}
        setFieldOptions={(o) => setOptions({ fieldOptions: o })}
        setEditingField={setEditingField}
        allowSetDefault={!!source}
        defaultOptions={defaultOptions}
      />
    </Box>
  );
};
