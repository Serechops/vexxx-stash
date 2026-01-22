import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Paper,
  Box,
  TextField,
  LinearProgress,
  InputAdornment,
  Typography,
  FormControlLabel,
  Radio,
  RadioGroup,
  FormControl,
  FormHelperText,
  Checkbox,
  Stack,
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "react-router-dom";
import { HashLink } from "react-router-hash-link";

import * as GQL from "src/core/generated-graphql";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { ModalComponent } from "src/components/Shared/Modal";
import {
  stashBoxPerformerQuery,
  useJobsSubscribe,
  mutateStashBoxBatchPerformerTag,
  getClient,
  evictQueries,
  performerMutationImpactedQueries,
} from "src/core/StashService";
import { Manual } from "src/components/Help/Manual";
import { useConfigurationContext } from "src/hooks/Config";

import StashSearchResult from "./StashSearchResult";
import PerformerConfig from "./Config";
import { ITaggerConfig } from "../constants";
import PerformerModal from "../PerformerModal";
import { useUpdatePerformer } from "../queries";
import { faStar, faTags } from "@fortawesome/free-solid-svg-icons";
import { mergeStashIDs } from "src/utils/stashbox";
import { separateNamesAndStashIds } from "src/utils/stashIds";
import { ExternalLink } from "src/components/Shared/ExternalLink";
import { useTaggerConfig } from "../config";

type JobFragment = Pick<
  GQL.Job,
  "id" | "status" | "subTasks" | "description" | "progress"
>;

const CLASSNAME = "PerformerTagger";

interface IPerformerBatchUpdateModal {
  performers: GQL.PerformerDataFragment[];
  isIdle: boolean;
  selectedEndpoint: { endpoint: string; index: number };
  onBatchUpdate: (queryAll: boolean, refresh: boolean) => void;
  close: () => void;
}

const PerformerBatchUpdateModal: React.FC<IPerformerBatchUpdateModal> = ({
  performers,
  isIdle,
  selectedEndpoint,
  onBatchUpdate,
  close,
}) => {
  const intl = useIntl();

  const [queryAll, setQueryAll] = useState(false);

  const [refresh, setRefresh] = useState(false);
  const { data: allPerformers } = GQL.useFindPerformersQuery({
    variables: {
      performer_filter: {
        stash_id_endpoint: {
          endpoint: selectedEndpoint.endpoint,
          modifier: refresh
            ? GQL.CriterionModifier.NotNull
            : GQL.CriterionModifier.IsNull,
        },
      },
      filter: {
        per_page: 0,
      },
    },
  });

  const performerCount = useMemo(() => {
    // get all stash ids for the selected endpoint
    const filteredStashIDs = performers.map((p) =>
      p.stash_ids.filter((s) => s.endpoint === selectedEndpoint.endpoint)
    );

    return queryAll
      ? allPerformers?.findPerformers.count
      : filteredStashIDs.filter((s) =>
        // if refresh, then we filter out the performers without a stash id
        // otherwise, we want untagged performers, filtering out those with a stash id
        refresh ? s.length > 0 : s.length === 0
      ).length;
  }, [queryAll, refresh, performers, allPerformers, selectedEndpoint.endpoint]);

  return (
    <ModalComponent
      show
      icon={faTags}
      header={intl.formatMessage({
        id: "performer_tagger.update_performers",
      })}
      accept={{
        text: intl.formatMessage({
          id: "performer_tagger.update_performers",
        }),
        onClick: () => onBatchUpdate(queryAll, refresh),
      }}
      cancel={{
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "danger",
        onClick: () => close(),
      }}
      disabled={!isIdle}
    >
      <FormControl component="fieldset" className="tagger-form-group">
        <Typography variant="subtitle1" gutterBottom>
          <FormattedMessage id="performer_tagger.performer_selection" />
        </Typography>
        <RadioGroup
          name="performer-query"
          value={queryAll ? "all" : "page"}
          onChange={(e) => setQueryAll(e.target.value === "all")}
        >
          <FormControlLabel
            value="page"
            control={<Radio />}
            label={<FormattedMessage id="performer_tagger.current_page" />}
          />
          <FormControlLabel
            value="all"
            control={<Radio />}
            label={intl.formatMessage({
              id: "performer_tagger.query_all_performers_in_the_database",
            })}
          />
        </RadioGroup>
      </FormControl>
      <FormControl component="fieldset" className="tagger-form-group">
        <Typography variant="subtitle1" gutterBottom>
          <FormattedMessage id="performer_tagger.tag_status" />
        </Typography>
        <RadioGroup
          name="performer-refresh"
          value={refresh ? "tagged" : "untagged"}
          onChange={(e) => setRefresh(e.target.value === "tagged")}
        >
          <FormControlLabel
            value="untagged"
            control={<Radio />}
            label={intl.formatMessage({
              id: "performer_tagger.untagged_performers",
            })}
          />
          <FormHelperText>
            <FormattedMessage id="performer_tagger.updating_untagged_performers_description" />
          </FormHelperText>
          <FormControlLabel
            value="tagged"
            control={<Radio />}
            label={intl.formatMessage({
              id: "performer_tagger.refresh_tagged_performers",
            })}
          />
          <FormHelperText>
            <FormattedMessage id="performer_tagger.refreshing_will_update_the_data" />
          </FormHelperText>
        </RadioGroup>
      </FormControl>
      <Typography fontWeight="bold">
        <FormattedMessage
          id="performer_tagger.number_of_performers_will_be_processed"
          values={{
            performer_count: performerCount,
          }}
        />
      </Typography>
    </ModalComponent>
  );
};

interface IPerformerBatchAddModal {
  isIdle: boolean;
  onBatchAdd: (input: string) => void;
  close: () => void;
}

const PerformerBatchAddModal: React.FC<IPerformerBatchAddModal> = ({
  isIdle,
  onBatchAdd,
  close,
}) => {
  const intl = useIntl();

  const performerInput = useRef<HTMLTextAreaElement | null>(null);

  return (
    <ModalComponent
      show
      icon={faStar}
      header={intl.formatMessage({
        id: "performer_tagger.add_new_performers",
      })}
      accept={{
        text: intl.formatMessage({
          id: "performer_tagger.add_new_performers",
        }),
        onClick: () => {
          if (performerInput.current) {
            onBatchAdd(performerInput.current.value);
          } else {
            close();
          }
        },
      }}
      cancel={{
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "danger",
        onClick: () => close(),
      }}
      disabled={!isIdle}
    >
      <TextField
        className="text-input"
        multiline
        inputRef={performerInput}
        placeholder={intl.formatMessage({
          id: "performer_tagger.performer_names_or_stashids_separated_by_comma",
        })}
        rows={6}
        fullWidth
      />
      <FormHelperText>
        <FormattedMessage id="performer_tagger.any_names_entered_will_be_queried" />
      </FormHelperText>
    </ModalComponent>
  );
};

interface IPerformerTaggerListProps {
  performers: GQL.PerformerDataFragment[];
  selectedEndpoint: { endpoint: string; index: number };
  isIdle: boolean;
  config: ITaggerConfig;
  onBatchAdd: (performerInput: string) => void;
  onBatchUpdate: (ids: string[] | undefined, refresh: boolean) => void;
}

const PerformerTaggerList: React.FC<IPerformerTaggerListProps> = ({
  performers,
  selectedEndpoint,
  isIdle,
  config,
  onBatchAdd,
  onBatchUpdate,
}) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Record<string, GQL.ScrapedPerformerDataFragment[]>
  >({});
  const [searchErrors, setSearchErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [taggedPerformers, setTaggedPerformers] = useState<
    Record<string, Partial<GQL.SlimPerformerDataFragment>>
  >({});
  const [queries, setQueries] = useState<Record<string, string>>({});

  const [showBatchAdd, setShowBatchAdd] = useState(false);
  const [showBatchUpdate, setShowBatchUpdate] = useState(false);

  const [error, setError] = useState<
    Record<string, { message?: string; details?: string } | undefined>
  >({});
  const [loadingUpdate, setLoadingUpdate] = useState<string | undefined>();
  const [modalPerformer, setModalPerformer] = useState<
    GQL.ScrapedPerformerDataFragment | undefined
  >();

  const doBoxSearch = (performerID: string, searchVal: string) => {
    stashBoxPerformerQuery(searchVal, selectedEndpoint.endpoint)
      .then((queryData) => {
        const s = queryData.data?.scrapeSinglePerformer ?? [];
        setSearchResults({
          ...searchResults,
          [performerID]: s,
        });
        setSearchErrors({
          ...searchErrors,
          [performerID]: undefined,
        });
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        // Destructure to remove existing result
        const { [performerID]: unassign, ...results } = searchResults;
        setSearchResults(results);
        setSearchErrors({
          ...searchErrors,
          [performerID]: intl.formatMessage({
            id: "performer_tagger.network_error",
          }),
        });
      });

    setLoading(true);
  };

  const doBoxUpdate = (
    performerID: string,
    stashID: string,
    endpoint: string
  ) => {
    setLoadingUpdate(stashID);
    setError({
      ...error,
      [performerID]: undefined,
    });
    stashBoxPerformerQuery(stashID, endpoint)
      .then((queryData) => {
        const data = queryData.data?.scrapeSinglePerformer ?? [];
        if (data.length > 0) {
          setModalPerformer({
            ...data[0],
            stored_id: performerID,
          });
        }
      })
      .finally(() => setLoadingUpdate(undefined));
  };

  async function handleBatchAdd(input: string) {
    onBatchAdd(input);
    setShowBatchAdd(false);
  }

  const handleBatchUpdate = (queryAll: boolean, refresh: boolean) => {
    onBatchUpdate(!queryAll ? performers.map((p) => p.id) : undefined, refresh);
    setShowBatchUpdate(false);
  };

  const handleTaggedPerformer = (
    performer: Pick<GQL.SlimPerformerDataFragment, "id"> &
      Partial<Omit<GQL.SlimPerformerDataFragment, "id">>
  ) => {
    setTaggedPerformers({
      ...taggedPerformers,
      [performer.id]: performer,
    });
  };

  const updatePerformer = useUpdatePerformer();

  function handleSaveError(performerID: string, name: string, message: string) {
    setError({
      ...error,
      [performerID]: {
        message: intl.formatMessage(
          { id: "performer_tagger.failed_to_save_performer" },
          { performer: modalPerformer?.name }
        ),
        details:
          message === "UNIQUE constraint failed: performers.name"
            ? intl.formatMessage({
              id: "performer_tagger.name_already_exists",
            })
            : message,
      },
    });
  }

  const handlePerformerUpdate = async (
    existing: GQL.PerformerDataFragment,
    input: GQL.PerformerCreateInput
  ) => {
    setModalPerformer(undefined);
    const performerID = modalPerformer?.stored_id;
    if (performerID) {
      // handle stash ids - we want to add, not set them
      if (input.stash_ids?.length) {
        input.stash_ids = mergeStashIDs(existing.stash_ids, input.stash_ids);
      }

      const updateData: GQL.PerformerUpdateInput = {
        ...input,
        id: performerID,
      };

      const res = await updatePerformer(updateData);
      if (!res.data?.performerUpdate)
        handleSaveError(
          performerID,
          modalPerformer?.name ?? "",
          res?.errors?.[0]?.message ?? ""
        );
    }
  };

  const renderPerformers = () =>
    performers.map((performer) => {
      const isTagged = taggedPerformers[performer.id];

      const stashID = performer.stash_ids.find((s) => {
        return s.endpoint === selectedEndpoint.endpoint;
      });

      let mainContent;
      if (!isTagged && stashID !== undefined) {
        mainContent = (
          <Box textAlign="left">
            <Typography variant="h5" fontWeight="bold">
              <FormattedMessage id="performer_tagger.performer_already_tagged" />
            </Typography>
          </Box>
        );
      } else if (!isTagged && !stashID) {
        mainContent = (
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"

              defaultValue={performer.name ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setQueries({
                  ...queries,
                  [performer.id]: e.target.value,
                })
              }
              onKeyPress={(e: React.KeyboardEvent<HTMLInputElement>) =>
                e.key === "Enter" &&
                doBoxSearch(
                  performer.id,
                  queries[performer.id] ?? performer.name ?? ""
                )
              }
              className="text-input tagger-flex-grow"
            />
            <Button
              variant="outlined"
              disabled={loading}
              onClick={() =>
                doBoxSearch(
                  performer.id,
                  queries[performer.id] ?? performer.name ?? ""
                )
              }
            >
              <FormattedMessage id="actions.search" />
            </Button>
          </Stack>
        );
      } else if (isTagged) {
        mainContent = (
          <Box display="flex" flexDirection="column" textAlign="left">
            <Typography variant="h5">
              <FormattedMessage id="performer_tagger.performer_successfully_tagged" />
            </Typography>
            <Typography variant="h6">
              <Link className="bold" to={`/performers/${performer.id}`}>
                {taggedPerformers[performer.id].name}
              </Link>
            </Typography>
          </Box>
        );
      }

      let subContent;
      if (stashID !== undefined) {
        const base = stashID.endpoint.match(/https?:\/\/.*?\//)?.[0];
        const link = base ? (
          <Box fontSize="small">
            <ExternalLink
              href={`${base}performers/${stashID.stash_id}`}
              className="block"
            >
              {stashID.stash_id}
            </ExternalLink>
          </Box>
        ) : (
          <Typography variant="body2">{stashID.stash_id}</Typography>
        );

        subContent = (
          <div key={performer.id}>
            <Stack direction="row" spacing={1} className="PerformerTagger-box-link" alignItems="center">
              <Box className="tagger-flex-grow">{link}</Box>
              <Button
                variant="outlined"
                onClick={() =>
                  doBoxUpdate(
                    performer.id,
                    stashID.stash_id,
                    stashID.endpoint
                  )
                }
                disabled={!!loadingUpdate}
              >
                {loadingUpdate === stashID.stash_id ? (
                  <LoadingIndicator inline small message="" />
                ) : (
                  <FormattedMessage id="actions.refresh" />
                )}
              </Button>
            </Stack>
            {error[performer.id] && (
              <Box color="error.main" mt={1}>
                <Typography component="strong">
                  <Box component="span" className="tagger-error-label">Error:</Box>
                  {error[performer.id]?.message}
                </Typography>
                <div>{error[performer.id]?.details}</div>
              </Box>
            )}
          </div>
        );
      } else if (searchErrors[performer.id]) {
        subContent = (
          <Typography color="error" fontWeight="bold">
            {searchErrors[performer.id]}
          </Typography>
        );
      } else if (searchResults[performer.id]?.length === 0) {
        subContent = (
          <Typography color="error" fontWeight="bold">
            <FormattedMessage id="performer_tagger.no_results_found" />
          </Typography>
        );
      }

      let searchResult;
      if (searchResults[performer.id]?.length > 0 && !isTagged) {
        searchResult = (
          <StashSearchResult
            key={performer.id}
            stashboxPerformers={searchResults[performer.id]}
            performer={performer}
            endpoint={selectedEndpoint.endpoint}
            onPerformerTagged={handleTaggedPerformer}
            excludedPerformerFields={config.excludedPerformerFields ?? []}
          />
        );
      }

      return (
        <div key={performer.id} className={`${CLASSNAME}-performer`}>
          {modalPerformer && (
            <PerformerModal
              closeModal={() => setModalPerformer(undefined)}
              modalVisible={modalPerformer.stored_id === performer.id}
              performer={modalPerformer}
              onSave={(input) => {
                handlePerformerUpdate(performer, input);
              }}
              excludedPerformerFields={config.excludedPerformerFields}
              icon={faTags}
              header={intl.formatMessage({
                id: "performer_tagger.update_performer",
              })}
              endpoint={selectedEndpoint.endpoint}
            />
          )}
          <Paper className="performer-card">
            <img src={performer.image_path ?? ""} alt="" loading="lazy" />
          </Paper>
          <div className={`${CLASSNAME}-details`}>
            <Link
              to={`/performers/${performer.id}`}
              className={`${CLASSNAME}-header`}
            >
              <h2>
                {performer.name}
                {performer.disambiguation && (
                  <span className="performer-disambiguation">
                    {` (${performer.disambiguation})`}
                  </span>
                )}
              </h2>
            </Link>
            {mainContent}
            <Box className="sub-content" textAlign="left">{subContent}</Box>
            {searchResult}
          </div>
        </div>
      );
    });

  return (
    <Paper className="tagger-content-paper">
      {showBatchUpdate && (
        <PerformerBatchUpdateModal
          close={() => setShowBatchUpdate(false)}
          isIdle={isIdle}
          selectedEndpoint={selectedEndpoint}
          performers={performers}
          onBatchUpdate={handleBatchUpdate}
        />
      )}

      {showBatchAdd && (
        <PerformerBatchAddModal
          close={() => setShowBatchAdd(false)}
          isIdle={isIdle}
          onBatchAdd={handleBatchAdd}
        />
      )}

      <Box className="tagger-action-header">
        <Button variant="outlined" onClick={() => setShowBatchAdd(true)}>
          <FormattedMessage id="performer_tagger.batch_add_performers" />
        </Button>
        <Button variant="outlined" className="tagger-button-spacer" onClick={() => setShowBatchUpdate(true)}>
          <FormattedMessage id="performer_tagger.batch_update_performers" />
        </Button>
      </Box>
      <Box className="tagger-container tagger-content-container">{renderPerformers()}</Box>
    </Paper>
  );
};

interface ITaggerProps {
  performers: GQL.PerformerDataFragment[];
}

export const PerformerTagger: React.FC<ITaggerProps> = ({ performers }) => {
  const jobsSubscribe = useJobsSubscribe();
  const intl = useIntl();
  const { configuration: stashConfig } = useConfigurationContext();
  const { config, setConfig } = useTaggerConfig();
  const [showConfig, setShowConfig] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const [batchJobID, setBatchJobID] = useState<string | undefined | null>();
  const [batchJob, setBatchJob] = useState<JobFragment | undefined>();

  // monitor batch operation
  useEffect(() => {
    if (!jobsSubscribe.data) {
      return;
    }

    const event = jobsSubscribe.data.jobsSubscribe;
    if (event.job.id !== batchJobID) {
      return;
    }

    if (event.type !== GQL.JobStatusUpdateType.Remove) {
      setBatchJob(event.job);
    } else {
      setBatchJob(undefined);
      setBatchJobID(undefined);

      // Once the performer batch is complete, refresh all local performer data
      const ac = getClient();
      evictQueries(ac.cache, performerMutationImpactedQueries);
    }
  }, [jobsSubscribe, batchJobID]);

  if (!config) return <LoadingIndicator />;

  const savedEndpointIndex =
    stashConfig?.general.stashBoxes.findIndex(
      (s) => s.endpoint === config.selectedEndpoint
    ) ?? -1;
  const selectedEndpointIndex =
    savedEndpointIndex === -1 && stashConfig?.general.stashBoxes.length
      ? 0
      : savedEndpointIndex;
  const selectedEndpoint =
    stashConfig?.general.stashBoxes[selectedEndpointIndex];

  async function batchAdd(performerInput: string) {
    if (performerInput && selectedEndpoint) {
      const inputs = performerInput
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n.length > 0);

      const { names, stashIds } = separateNamesAndStashIds(inputs);

      if (names.length > 0 || stashIds.length > 0) {
        const ret = await mutateStashBoxBatchPerformerTag({
          names: names.length > 0 ? names : undefined,
          stash_ids: stashIds.length > 0 ? stashIds : undefined,
          endpoint: selectedEndpointIndex,
          refresh: false,
          createParent: false,
        });

        setBatchJobID(ret.data?.stashBoxBatchPerformerTag);
      }
    }
  }

  async function batchUpdate(ids: string[] | undefined, refresh: boolean) {
    if (config && selectedEndpoint) {
      const ret = await mutateStashBoxBatchPerformerTag({
        ids: ids,
        endpoint: selectedEndpointIndex,
        refresh,
        exclude_fields: config.excludedPerformerFields ?? [],
        createParent: false,
      });

      setBatchJobID(ret.data?.stashBoxBatchPerformerTag);
    }
  }

  // const progress =
  //   jobStatus.data?.metadataUpdate.status ===
  //     "Stash-Box Performer Batch Operation" &&
  //   jobStatus.data.metadataUpdate.progress >= 0
  //     ? jobStatus.data.metadataUpdate.progress * 100
  //     : null;

  function renderStatus() {
    if (batchJob) {
      const progress =
        batchJob.progress !== undefined && batchJob.progress !== null
          ? batchJob.progress * 100
          : undefined;
      return (
        <Box className="tagger-status-container">
          <Typography variant="h6">
            <FormattedMessage id="performer_tagger.status_tagging_performers" />
          </Typography>
          {progress !== undefined && (
            <LinearProgress
              variant="determinate"
              value={progress}
            />
          )}
        </Box>
      );
    }

    if (batchJobID !== undefined) {
      return (
        <Box className="tagger-status-container">
          <Typography variant="h6">
            <FormattedMessage id="performer_tagger.status_tagging_job_queued" />
          </Typography>
        </Box>
      );
    }
  }

  const showHideConfigId = showConfig
    ? "actions.hide_configuration"
    : "actions.show_configuration";

  return (
    <>
      <Manual
        show={showManual}
        onClose={() => setShowManual(false)}
        defaultActiveTab="Tagger.md"
      />
      {renderStatus()}
      <Box className="tagger-container tagger-content-container">
        {selectedEndpointIndex !== -1 && selectedEndpoint ? (
          <>
            <Box display="flex" mb={2}>
              <Button onClick={() => setShowConfig(!showConfig)} variant="text">
                {intl.formatMessage({ id: showHideConfigId })}
              </Button>
              <Button
                className="tagger-action-header"
                onClick={() => setShowManual(true)}
                title={intl.formatMessage({ id: "help" })}
                variant="text"
              >
                <FormattedMessage id="help" />
              </Button>
            </Box>

            <PerformerConfig
              config={config}
              setConfig={setConfig}
              show={showConfig}
            />
            <PerformerTaggerList
              performers={performers}
              selectedEndpoint={{
                endpoint: selectedEndpoint.endpoint,
                index: selectedEndpointIndex,
              }}
              isIdle={batchJobID === undefined}
              config={config}
              onBatchAdd={batchAdd}
              onBatchUpdate={batchUpdate}
            />
          </>
        ) : (
          <Box my={4}>
            <Typography variant="h3" align="center" mt={4}>
              <FormattedMessage id="performer_tagger.to_use_the_performer_tagger" />
            </Typography>
            <Typography variant="h5" align="center">
              Please see{" "}
              <HashLink
                to="/settings?tab=metadata-providers#stash-boxes"
                scroll={(el) =>
                  el.scrollIntoView({ behavior: "smooth", block: "center" })
                }
              >
                Settings.
              </HashLink>
            </Typography>
          </Box>
        )}
      </Box>
    </>
  );
};
