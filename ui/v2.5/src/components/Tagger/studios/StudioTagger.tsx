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
  stashBoxStudioQuery,
  useJobsSubscribe,
  mutateStashBoxBatchStudioTag,
  getClient,
  studioMutationImpactedQueries,
  useStudioCreate,
  evictQueries,
} from "src/core/StashService";
import { Manual } from "src/components/Help/Manual";
import { useConfigurationContext } from "src/hooks/Config";

import StashSearchResult from "./StashSearchResult";
import StudioConfig from "./Config";
import { ITaggerConfig } from "../constants";
import StudioModal from "../scenes/StudioModal";
import { useUpdateStudio } from "../queries";
import { apolloError } from "src/utils";
import { faStar, faTags } from "@fortawesome/free-solid-svg-icons";
import { ExternalLink } from "src/components/Shared/ExternalLink";
import { mergeStudioStashIDs } from "../utils";
import { separateNamesAndStashIds } from "src/utils/stashIds";
import { useTaggerConfig } from "../config";

type JobFragment = Pick<
  GQL.Job,
  "id" | "status" | "subTasks" | "description" | "progress"
>;

const CLASSNAME = "StudioTagger";

interface IStudioBatchUpdateModal {
  studios: GQL.StudioDataFragment[];
  isIdle: boolean;
  selectedEndpoint: { endpoint: string; index: number };
  onBatchUpdate: (queryAll: boolean, refresh: boolean) => void;
  batchAddParents: boolean;
  setBatchAddParents: (addParents: boolean) => void;
  close: () => void;
}

const StudioBatchUpdateModal: React.FC<IStudioBatchUpdateModal> = ({
  studios,
  isIdle,
  selectedEndpoint,
  onBatchUpdate,
  batchAddParents,
  setBatchAddParents,
  close,
}) => {
  const intl = useIntl();

  const [queryAll, setQueryAll] = useState(false);

  const [refresh, setRefresh] = useState(false);
  const { data: allStudios } = GQL.useFindStudiosQuery({
    variables: {
      studio_filter: {
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

  const studioCount = useMemo(() => {
    // get all stash ids for the selected endpoint
    const filteredStashIDs = studios.map((p) =>
      p.stash_ids.filter((s) => s.endpoint === selectedEndpoint.endpoint)
    );

    return queryAll
      ? allStudios?.findStudios.count
      : filteredStashIDs.filter((s) =>
        // if refresh, then we filter out the studios without a stash id
        // otherwise, we want untagged studios, filtering out those with a stash id
        refresh ? s.length > 0 : s.length === 0
      ).length;
  }, [queryAll, refresh, studios, allStudios, selectedEndpoint.endpoint]);

  return (
    <ModalComponent
      show
      icon={faTags}
      header={intl.formatMessage({
        id: "studio_tagger.update_studios",
      })}
      accept={{
        text: intl.formatMessage({
          id: "studio_tagger.update_studios",
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
      <FormControl component="fieldset" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          <FormattedMessage id="studio_tagger.studio_selection" />
        </Typography>
        <RadioGroup
          name="studio-query"
          value={queryAll ? "all" : "page"}
          onChange={(e) => setQueryAll(e.target.value === "all")}
        >
          <FormControlLabel
            value="page"
            control={<Radio />}
            label={<FormattedMessage id="studio_tagger.current_page" />}
          />
          <FormControlLabel
            value="all"
            control={<Radio />}
            label={intl.formatMessage({
              id: "studio_tagger.query_all_studios_in_the_database",
            })}
          />
        </RadioGroup>
      </FormControl>
      <FormControl component="fieldset" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          <FormattedMessage id="studio_tagger.tag_status" />
        </Typography>
        <RadioGroup
          name="studio-refresh"
          value={refresh ? "tagged" : "untagged"}
          onChange={(e) => setRefresh(e.target.value === "tagged")}
        >
          <FormControlLabel
            value="untagged"
            control={<Radio />}
            label={intl.formatMessage({
              id: "studio_tagger.untagged_studios",
            })}
          />
          <FormHelperText>
            <FormattedMessage id="studio_tagger.updating_untagged_studios_description" />
          </FormHelperText>
          <FormControlLabel
            value="tagged"
            control={<Radio />}
            label={intl.formatMessage({
              id: "studio_tagger.refresh_tagged_studios",
            })}
          />
          <FormHelperText>
            <FormattedMessage id="studio_tagger.refreshing_will_update_the_data" />
          </FormHelperText>
        </RadioGroup>
        <Box sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                id="add-parent"
                checked={batchAddParents}
                onChange={() => setBatchAddParents(!batchAddParents)}
              />
            }
            label={intl.formatMessage({
              id: "studio_tagger.create_or_tag_parent_studios",
            })}
          />
        </Box>
      </FormControl>
      <Typography fontWeight="bold">
        <FormattedMessage
          id="studio_tagger.number_of_studios_will_be_processed"
          values={{
            studio_count: studioCount,
          }}
        />
      </Typography>
    </ModalComponent>
  );
};

interface IStudioBatchAddModal {
  isIdle: boolean;
  onBatchAdd: (input: string) => void;
  batchAddParents: boolean;
  setBatchAddParents: (addParents: boolean) => void;
  close: () => void;
}

const StudioBatchAddModal: React.FC<IStudioBatchAddModal> = ({
  isIdle,
  onBatchAdd,
  batchAddParents,
  setBatchAddParents,
  close,
}) => {
  const intl = useIntl();

  const studioInput = useRef<HTMLTextAreaElement | null>(null);

  return (
    <ModalComponent
      show
      icon={faStar}
      header={intl.formatMessage({
        id: "studio_tagger.add_new_studios",
      })}
      accept={{
        text: intl.formatMessage({
          id: "studio_tagger.add_new_studios",
        }),
        onClick: () => {
          if (studioInput.current) {
            onBatchAdd(studioInput.current.value);
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
        inputRef={studioInput}
        placeholder={intl.formatMessage({
          id: "studio_tagger.studio_names_or_stashids_separated_by_comma",
        })}
        rows={6}
        fullWidth
      />
      <FormHelperText>
        <FormattedMessage id="studio_tagger.any_names_entered_will_be_queried" />
      </FormHelperText>
      <Box sx={{ mt: 1 }}>
        <FormControlLabel
          control={
            <Checkbox
              id="add-parent"
              checked={batchAddParents}
              onChange={() => setBatchAddParents(!batchAddParents)}
            />
          }
          label={intl.formatMessage({
            id: "studio_tagger.create_or_tag_parent_studios",
          })}
        />
      </Box>
    </ModalComponent>
  );
};

interface IStudioTaggerListProps {
  studios: GQL.StudioDataFragment[];
  selectedEndpoint: { endpoint: string; index: number };
  isIdle: boolean;
  config: ITaggerConfig;
  onBatchAdd: (studioInput: string, createParent: boolean) => void;
  onBatchUpdate: (
    ids: string[] | undefined,
    refresh: boolean,
    createParent: boolean
  ) => void;
}

const StudioTaggerList: React.FC<IStudioTaggerListProps> = ({
  studios,
  selectedEndpoint,
  isIdle,
  config,
  onBatchAdd,
  onBatchUpdate,
}) => {
  const intl = useIntl();

  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Record<string, GQL.ScrapedStudioDataFragment[]>
  >({});
  const [searchErrors, setSearchErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [taggedStudios, setTaggedStudios] = useState<
    Record<string, Partial<GQL.SlimStudioDataFragment>>
  >({});
  const [queries, setQueries] = useState<Record<string, string>>({});

  const [showBatchAdd, setShowBatchAdd] = useState(false);
  const [showBatchUpdate, setShowBatchUpdate] = useState(false);
  const [batchAddParents, setBatchAddParents] = useState(
    config.createParentStudios || false
  );

  const [error, setError] = useState<
    Record<string, { message?: string; details?: string } | undefined>
  >({});
  const [loadingUpdate, setLoadingUpdate] = useState<string | undefined>();
  const [modalStudio, setModalStudio] = useState<
    GQL.ScrapedStudioDataFragment | undefined
  >();

  const doBoxSearch = (studioID: string, searchVal: string) => {
    stashBoxStudioQuery(searchVal, selectedEndpoint.endpoint)
      .then((queryData) => {
        const s = queryData.data?.scrapeSingleStudio ?? [];
        setSearchResults({
          ...searchResults,
          [studioID]: s,
        });
        setSearchErrors({
          ...searchErrors,
          [studioID]: undefined,
        });
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        // Destructure to remove existing result
        const { [studioID]: unassign, ...results } = searchResults;
        setSearchResults(results);
        setSearchErrors({
          ...searchErrors,
          [studioID]: intl.formatMessage({
            id: "studio_tagger.network_error",
          }),
        });
      });

    setLoading(true);
  };

  const doBoxUpdate = (studioID: string, stashID: string, endpoint: string) => {
    setLoadingUpdate(stashID);
    setError({
      ...error,
      [studioID]: undefined,
    });
    stashBoxStudioQuery(stashID, endpoint)
      .then((queryData) => {
        const data = queryData.data?.scrapeSingleStudio ?? [];
        if (data.length > 0) {
          setModalStudio({
            ...data[0],
            stored_id: studioID,
          });
        }
      })
      .finally(() => setLoadingUpdate(undefined));
  };

  async function handleBatchAdd(input: string) {
    onBatchAdd(input, batchAddParents);
    setShowBatchAdd(false);
  }

  const handleBatchUpdate = (queryAll: boolean, refresh: boolean) => {
    onBatchUpdate(
      !queryAll ? studios.map((p) => p.id) : undefined,
      refresh,
      batchAddParents
    );
    setShowBatchUpdate(false);
  };

  const handleTaggedStudio = (
    studio: Pick<GQL.SlimStudioDataFragment, "id"> &
      Partial<Omit<GQL.SlimStudioDataFragment, "id">>
  ) => {
    setTaggedStudios({
      ...taggedStudios,
      [studio.id]: studio,
    });
  };

  const [createStudio] = useStudioCreate();
  const updateStudio = useUpdateStudio();

  function handleSaveError(studioID: string, name: string, message: string) {
    setError({
      ...error,
      [studioID]: {
        message: intl.formatMessage(
          { id: "studio_tagger.failed_to_save_studio" },
          { studio: modalStudio?.name }
        ),
        details:
          message === "UNIQUE constraint failed: studios.name"
            ? intl.formatMessage({
              id: "studio_tagger.name_already_exists",
            })
            : message,
      },
    });
  }

  const handleStudioUpdate = async (
    input: GQL.StudioCreateInput,
    parentInput?: GQL.StudioCreateInput
  ) => {
    setModalStudio(undefined);
    const studioID = modalStudio?.stored_id;
    if (studioID) {
      if (parentInput) {
        try {
          // if parent id is set, then update the existing studio
          if (input.parent_id) {
            const parentUpdateData: GQL.StudioUpdateInput = {
              ...parentInput,
              id: input.parent_id,
            };
            parentUpdateData.stash_ids = await mergeStudioStashIDs(
              input.parent_id,
              parentInput.stash_ids ?? []
            );
            await updateStudio(parentUpdateData);
          } else {
            const parentRes = await createStudio({
              variables: { input: parentInput },
            });
            input.parent_id = parentRes.data?.studioCreate?.id;
          }
        } catch (e) {
          handleSaveError(studioID, parentInput.name, apolloError(e));
        }
      }

      const updateData: GQL.StudioUpdateInput = {
        ...input,
        id: studioID,
      };
      updateData.stash_ids = await mergeStudioStashIDs(
        studioID,
        input.stash_ids ?? []
      );

      const res = await updateStudio(updateData);
      if (!res.data?.studioUpdate)
        handleSaveError(
          studioID,
          modalStudio?.name ?? "",
          res?.errors?.[0]?.message ?? ""
        );
    }
  };

  const renderStudios = () =>
    studios.map((studio) => {
      const isTagged = taggedStudios[studio.id];

      const stashID = studio.stash_ids.find((s) => {
        return s.endpoint === selectedEndpoint.endpoint;
      });

      let mainContent;
      if (!isTagged && stashID !== undefined) {
        mainContent = (
          <Box textAlign="left">
            <Typography variant="h5" fontWeight="bold">
              <FormattedMessage id="studio_tagger.studio_already_tagged" />
            </Typography>
          </Box>
        );
      } else if (!isTagged && !stashID) {
        mainContent = (
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              className="text-input"
              defaultValue={studio.name ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setQueries({
                  ...queries,
                  [studio.id]: e.target.value,
                })
              }
              onKeyPress={(e: React.KeyboardEvent<HTMLInputElement>) =>
                e.key === "Enter" &&
                doBoxSearch(studio.id, queries[studio.id] ?? studio.name ?? "")
              }
              sx={{ flexGrow: 1 }}
            />
            <Button
              variant="outlined"
              disabled={loading}
              onClick={() =>
                doBoxSearch(
                  studio.id,
                  queries[studio.id] ?? studio.name ?? ""
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
              <FormattedMessage id="studio_tagger.studio_successfully_tagged" />
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
              href={`${base}studios/${stashID.stash_id}`}
              className="block"
            >
              {stashID.stash_id}
            </ExternalLink>
          </Box>
        ) : (
          <Typography variant="body2">{stashID.stash_id}</Typography>
        );

        subContent = (
          <Box key={studio.id}>
            <Stack direction="row" spacing={1} className="StudioTagger-box-link" alignItems="center">
              <Box sx={{ flexGrow: 1 }}>{link}</Box>
              <Button
                variant="outlined"
                onClick={() =>
                  doBoxUpdate(studio.id, stashID.stash_id, stashID.endpoint)
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
            {error[studio.id] && (
              <Box color="error.main" mt={1}>
                <Typography component="strong" fontWeight="bold">
                  <Box component="span" sx={{ mr: 1 }}>Error:</Box>
                  {error[studio.id]?.message}
                </Typography>
                <div>{error[studio.id]?.details}</div>
              </Box>
            )}
          </Box>
        );
      } else if (searchErrors[studio.id]) {
        subContent = (
          <Typography color="error" fontWeight="bold">
            {searchErrors[studio.id]}
          </Typography>
        );
      } else if (searchResults[studio.id]?.length === 0) {
        subContent = (
          <Typography color="error" fontWeight="bold">
            <FormattedMessage id="studio_tagger.no_results_found" />
          </Typography>
        );
      }

      let searchResult;
      if (searchResults[studio.id]?.length > 0 && !isTagged) {
        searchResult = (
          <StashSearchResult
            key={studio.id}
            stashboxStudios={searchResults[studio.id]}
            studio={studio}
            endpoint={selectedEndpoint.endpoint}
            onStudioTagged={handleTaggedStudio}
            excludedStudioFields={config.excludedStudioFields ?? []}
          />
        );
      }

      return (
        <div key={studio.id} className={`${CLASSNAME}-studio`}>
          {modalStudio && (
            <StudioModal
              closeModal={() => setModalStudio(undefined)}
              modalVisible={modalStudio.stored_id === studio.id}
              studio={modalStudio}
              handleStudioCreate={handleStudioUpdate}
              excludedStudioFields={config.excludedStudioFields}
              icon={faTags}
              header={intl.formatMessage({
                id: "studio_tagger.update_studio",
              })}
              endpoint={selectedEndpoint.endpoint}
            />
          )}
          <div className={`${CLASSNAME}-details`}>
            <div></div>
            <div>
              <Paper className="studio-card">
                <img loading="lazy" src={studio.image_path ?? ""} alt="" />
              </Paper>
            </div>
            <div className={`${CLASSNAME}-details-text`}>
              <Link
                to={`/studios/${studio.id}`}
                className={`${CLASSNAME}-header`}
              >
                <h2>{studio.name}</h2>
              </Link>
              {mainContent}
              <div className="sub-content text-left">{subContent}</div>
              {searchResult}
            </div>
          </div>
        </div>
      );
    });

  return (
    <Paper sx={{ p: 2 }}>
      {showBatchUpdate && (
        <StudioBatchUpdateModal
          close={() => setShowBatchUpdate(false)}
          isIdle={isIdle}
          selectedEndpoint={selectedEndpoint}
          studios={studios}
          onBatchUpdate={handleBatchUpdate}
          batchAddParents={batchAddParents}
          setBatchAddParents={setBatchAddParents}
        />
      )}

      {showBatchAdd && (
        <StudioBatchAddModal
          close={() => setShowBatchAdd(false)}
          isIdle={isIdle}
          onBatchAdd={handleBatchAdd}
          batchAddParents={batchAddParents}
          setBatchAddParents={setBatchAddParents}
        />
      )}
      <Box ml="auto" mb={3}>
        <Button variant="outlined" onClick={() => setShowBatchAdd(true)}>
          <FormattedMessage id="studio_tagger.batch_add_studios" />
        </Button>
        <Button variant="outlined" sx={{ ml: 3 }} onClick={() => setShowBatchUpdate(true)}>
          <FormattedMessage id="studio_tagger.batch_update_studios" />
        </Button>
      </Box>
      <div className={CLASSNAME}>{renderStudios()}</div>
    </Paper>
  );
};

interface ITaggerProps {
  studios: GQL.StudioDataFragment[];
}

export const StudioTagger: React.FC<ITaggerProps> = ({ studios }) => {
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

      // Once the studio batch is complete, refresh all local studio data
      const ac = getClient();
      evictQueries(ac.cache, studioMutationImpactedQueries);
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

  async function batchAdd(studioInput: string, createParent: boolean) {
    if (studioInput && selectedEndpoint) {
      const inputs = studioInput
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n.length > 0);

      const { names, stashIds } = separateNamesAndStashIds(inputs);

      if (names.length > 0 || stashIds.length > 0) {
        const ret = await mutateStashBoxBatchStudioTag({
          names: names.length > 0 ? names : undefined,
          stash_ids: stashIds.length > 0 ? stashIds : undefined,
          endpoint: selectedEndpointIndex,
          refresh: false,
          exclude_fields: config?.excludedStudioFields ?? [],
          createParent: createParent,
        });

        setBatchJobID(ret.data?.stashBoxBatchStudioTag);
      }
    }
  }

  async function batchUpdate(
    ids: string[] | undefined,
    refresh: boolean,
    createParent: boolean
  ) {
    if (selectedEndpoint) {
      const ret = await mutateStashBoxBatchStudioTag({
        ids: ids,
        endpoint: selectedEndpointIndex,
        refresh,
        exclude_fields: config?.excludedStudioFields ?? [],
        createParent: createParent,
      });

      setBatchJobID(ret.data?.stashBoxBatchStudioTag);
    }
  }

  // const progress =
  //   jobStatus.data?.metadataUpdate.status ===
  //     "Stash-Box Studio Batch Operation" &&
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
        <Box sx={{ px: 2 }}>
          <Typography variant="h6">
            <FormattedMessage id="studio_tagger.status_tagging_studios" />
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
        <Box sx={{ px: 2 }}>
          <Typography variant="h6">
            <FormattedMessage id="studio_tagger.status_tagging_job_queued" />
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
      <div className="tagger-container mx-md-auto">
        {selectedEndpointIndex !== -1 && selectedEndpoint ? (
          <>
            <Box display="flex" mb={2}>
              <Button onClick={() => setShowConfig(!showConfig)} variant="text">
                {intl.formatMessage({ id: showHideConfigId })}
              </Button>
              <Button
                sx={{ ml: "auto" }}
                onClick={() => setShowManual(true)}
                title={intl.formatMessage({ id: "help" })}
                variant="text"
              >
                <FormattedMessage id="help" />
              </Button>
            </Box>

            <StudioConfig
              config={config}
              setConfig={setConfig}
              show={showConfig}
            />
            <StudioTaggerList
              studios={studios}
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
          <Typography variant="h4" align="center" sx={{ mt: 5 }}>
            <FormattedMessage id="tagger.configure_endpoint" />
          </Typography>
        )}
      </div>
    </>
  );
};
