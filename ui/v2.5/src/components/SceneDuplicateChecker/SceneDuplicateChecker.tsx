import React, { useEffect, useMemo, useState } from "react";
import { FormattedMessage, FormattedNumber, useIntl } from "react-intl";
import { Link, useHistory } from "react-router-dom";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Box,
  Typography,
  Checkbox,
  FormControlLabel,
  Grid,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  ButtonGroup,
  Tooltip,
} from "@mui/material";
import { Pagination } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { ErrorMessage } from "src/components/Shared/ErrorMessage";
import TextUtils from "src/utils/text";
import { HoverPopover } from "src/components/Shared/HoverPopover";
import { Icon } from "src/components/Shared/Icon";
import {
  faTrash,
  faCodeMerge,
  faBox,
  faExclamationTriangle,
  faFileAlt,
  faFilm,
  faImages,
  faMapMarkerAlt,
  faPencilAlt,
  faTag,
} from "@fortawesome/free-solid-svg-icons";
import { DeleteScenesDialog } from "src/components/Scenes/DeleteScenesDialog";
import { EditScenesDialog } from "src/components/Scenes/EditScenesDialog";
import { PerformerPopoverButton } from "src/components/Shared/PerformerPopoverButton";
import {
  GalleryLink,
  GroupLink,
  SceneMarkerLink,
  TagLink,
} from "src/components/Shared/TagLink";
import { SweatDrops } from "src/components/Shared/SweatDrops";
import { SceneMergeModal } from "src/components/Scenes/SceneMergeDialog";
import { objectTitle } from "src/core/files";
import { FileSize } from "src/components/Shared/FileSize";

const CLASSNAME = "duplicate-checker";
const defaultDurationDiff = "1";

const SceneDuplicateChecker: React.FC = () => {
  const intl = useIntl();
  const history = useHistory();
  const query = new URLSearchParams(history.location.search);
  const currentPage = Number.parseInt(query.get("page") ?? "1", 10);
  const pageSize = Number.parseInt(query.get("size") ?? "20", 10);
  const hashDistance = Number.parseInt(query.get("distance") ?? "0", 10);
  const durationDiff = Number.parseFloat(
    query.get("durationDiff") ?? defaultDurationDiff
  );

  const [currentPageSize, setCurrentPageSize] = useState(pageSize);
  const [isMultiDelete, setIsMultiDelete] = useState(false);
  const [deletingScenes, setDeletingScenes] = useState(false);
  const [editingScenes, setEditingScenes] = useState(false);
  const [chkSafeSelect, setChkSafeSelect] = useState(true);
  const [chkSameDuration, setChkSameDuration] = useState(false);

  const [checkedScenes, setCheckedScenes] = useState<Record<string, boolean>>(
    {}
  );

  const { data, loading, refetch } = GQL.useFindDuplicateScenesQuery({
    fetchPolicy: "no-cache",
    variables: {
      distance: hashDistance,
      duration_diff: durationDiff,
    },
  });

  const getGroupTotalSize = (group: GQL.SlimSceneDataFragment[]) => {
    // Sum all file sizes across all scenes in the group
    return group.reduce((groupTotal, scene) => {
      const sceneTotal = scene.files.reduce(
        (fileTotal, file) => fileTotal + (file.size ?? 0),
        0
      );
      return groupTotal + sceneTotal;
    }, 0);
  };

  const scenes = useMemo(() => {
    const groups = data?.findDuplicateScenes ?? [];
    // Sort by total file size descending (largest groups first)
    return [...groups].sort((a, b) => {
      return getGroupTotalSize(b) - getGroupTotalSize(a);
    });
  }, [data?.findDuplicateScenes]);

  const { data: missingPhash } = GQL.useFindScenesQuery({
    variables: {
      filter: {
        per_page: 0,
      },
      scene_filter: {
        is_missing: "phash",
        file_count: {
          modifier: GQL.CriterionModifier.GreaterThan,
          value: 0,
        },
      },
    },
  });

  const [selectedScenes, setSelectedScenes] = useState<
    GQL.SlimSceneDataFragment[] | null
  >(null);

  const [mergeScenes, setMergeScenes] =
    useState<{ id: string; title: string }[]>();

  const pageOptions = useMemo(() => {
    const pageSizes = [
      10, 20, 30, 40, 50, 100, 150, 200, 250, 500, 750, 1000, 1250, 1500,
    ];

    const filteredSizes = pageSizes.filter((s, i) => {
      return scenes.length > s || i == 0 || scenes.length > pageSizes[i - 1];
    });

    return filteredSizes.map((size) => {
      return (
        <MenuItem key={size} value={size}>
          {size}
        </MenuItem>
      );
    });
  }, [scenes.length]);

  if (loading) return <LoadingIndicator />;
  if (!data) return <ErrorMessage error="Error searching for duplicates." />;

  const filteredScenes = scenes.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );
  const checkCount = Object.keys(checkedScenes).filter(
    (id) => checkedScenes[id]
  ).length;

  const setQuery = (q: Record<string, string | number | undefined>) => {
    const newQuery = new URLSearchParams(query);
    for (const key of Object.keys(q)) {
      const value = q[key];
      if (value !== undefined) {
        newQuery.set(key, String(value));
      } else {
        newQuery.delete(key);
      }
    }
    history.push({ search: newQuery.toString() });
  };

  const resetCheckboxSelection = () => {
    const updatedScenes: Record<string, boolean> = {};

    Object.keys(checkedScenes).forEach((sceneKey) => {
      updatedScenes[sceneKey] = false;
    });

    setCheckedScenes(updatedScenes);
  };

  function onDeleteDialogClosed(deleted: boolean) {
    setDeletingScenes(false);
    if (deleted) {
      setSelectedScenes(null);
      refetch();
      if (isMultiDelete) setCheckedScenes({});
    }
    resetCheckboxSelection();
  }

  const findLargestScene = (group: GQL.SlimSceneDataFragment[]) => {
    // Get maximum file size of a scene
    const totalSize = (scene: GQL.SlimSceneDataFragment) => {
      return scene.files.reduce((prev: number, f) => Math.max(prev, f.size ?? 0), 0);
    };
    // Find scene object with maximum total size
    return group.reduce((largest, scene) => {
      const largestSize = totalSize(largest);
      const currentSize = totalSize(scene);
      return currentSize > largestSize ? scene : largest;
    });
  };

  const findLargestResolutionScene = (group: GQL.SlimSceneDataFragment[]) => {
    // Get maximum resolution of a scene
    const sceneResolution = (scene: GQL.SlimSceneDataFragment) => {
      return scene.files.reduce(
        (prev: number, f) => Math.max(prev, (f.height ?? 0) * (f.width ?? 0)),
        0
      );
    };
    // Find scene object with maximum resolution
    return group.reduce((largest, scene) => {
      const largestSize = sceneResolution(largest);
      const currentSize = sceneResolution(scene);
      return currentSize > largestSize ? scene : largest;
    });
  };

  // Helper to get file date

  const findFirstFileByAge = (
    oldest: boolean,
    compareScenes: GQL.SlimSceneDataFragment[]
  ) => {
    let selectedFile: GQL.VideoFileDataFragment | undefined;
    let oldestTimestamp: Date | undefined = undefined;

    // Loop through all files
    for (const file of compareScenes.flatMap((s) => s.files)) {
      // Get timestamp
      if (!file.mod_time) continue;
      const timestamp: Date = new Date(file.mod_time);

      // Check if current file is oldest
      if (oldest) {
        if (oldestTimestamp === undefined || timestamp < oldestTimestamp) {
          oldestTimestamp = timestamp;
          selectedFile = file;
        }
      } else {
        if (oldestTimestamp === undefined || timestamp > oldestTimestamp) {
          oldestTimestamp = timestamp;
          selectedFile = file;
        }
      }
    }

    if (!selectedFile) return undefined;

    // Find scene with oldest file
    return compareScenes.find((s) =>
      s.files.some((f) => f.id === selectedFile?.id)
    );
  };

  function checkSameCodec(codecGroup: GQL.SlimSceneDataFragment[]) {
    const codecs = codecGroup.map((s) => s.files[0]?.video_codec);
    return new Set(codecs).size === 1;
  }

  function checkSameResolution(dataGroup: GQL.SlimSceneDataFragment[]) {
    const resolutions = dataGroup.map(
      (s) => (s.files[0]?.width ?? 0) * (s.files[0]?.height ?? 0)
    );
    return new Set(resolutions).size === 1;
  }

  const onSelectLargestClick = () => {
    setSelectedScenes([]);
    const checkedArray: Record<string, boolean> = {};

    filteredScenes.forEach((group) => {
      if (chkSafeSelect && !checkSameCodec(group)) {
        return;
      }
      // Find largest scene in group a
      const largest = findLargestScene(group);
      group.forEach((scene) => {
        if (scene !== largest) {
          checkedArray[scene.id] = true;
        }
      });
    });

    setCheckedScenes(checkedArray);
  };

  const onSelectLargestResolutionClick = () => {
    setSelectedScenes([]);
    const checkedArray: Record<string, boolean> = {};

    filteredScenes.forEach((group) => {
      if (chkSafeSelect && !checkSameCodec(group)) {
        return;
      }
      // Don't select scenes where resolution is identical.
      if (checkSameResolution(group)) {
        return;
      }
      // Find the highest resolution scene in group.
      const highest = findLargestResolutionScene(group);
      group.forEach((scene) => {
        if (scene !== highest) {
          checkedArray[scene.id] = true;
        }
      });
    });

    setCheckedScenes(checkedArray);
  };

  const onSelectByAge = (oldest: boolean) => {
    setSelectedScenes([]);

    const checkedArray: Record<string, boolean> = {};

    filteredScenes.forEach((group) => {
      if (chkSafeSelect && !checkSameCodec(group)) {
        return;
      }

      const oldestScene = findFirstFileByAge(oldest, group);
      if (!oldestScene) return;

      group.forEach((scene) => {
        if (scene !== oldestScene) {
          checkedArray[scene.id] = true;
        }
      });
    });

    setCheckedScenes(checkedArray);
  };

  const handleCheck = (checked: boolean, sceneID: string) => {
    setCheckedScenes({ ...checkedScenes, [sceneID]: checked });
  };

  const handleDeleteSelected = () => {
    setSelectedScenes(scenes.flat().filter((s) => checkedScenes[s.id]));
    setDeletingScenes(true);
    setIsMultiDelete(true);
  };

  const handleDeleteScene = (scene: GQL.SlimSceneDataFragment) => {
    setSelectedScenes([scene]);
    setDeletingScenes(true);
    setIsMultiDelete(false);
  };

  function onEdit() {
    setSelectedScenes(scenes.flat().filter((s) => checkedScenes[s.id]));
    setEditingScenes(true);
    resetCheckboxSelection();
  }

  function maybeRenderMissingPhashWarning() {
    const missingPhashes = missingPhash?.findScenes.count ?? 0;
    if (missingPhashes > 0) {
      return (
        <Typography variant="body1" className="lead" color="warning.main">
          <Icon icon={faExclamationTriangle} style={{ color: '#d9822b' }} />
          Missing phashes for {missingPhashes} scenes. Please run the phash
          generation task.
        </Typography>
      );
    }
  }

  function maybeRenderEdit() {
    if (editingScenes && selectedScenes) {
      return (
        <EditScenesDialog
          selected={selectedScenes}
          onClose={() => setEditingScenes(false)}
        />
      );
    }
  }

  function maybeRenderTagPopoverButton(scene: GQL.SlimSceneDataFragment) {
    if (scene.tags.length <= 0) return;

    const popoverContent = scene.tags.map((tag) => (
      <TagLink key={tag.id} tag={tag} />
    ));

    return (
      <HoverPopover placement="bottom" content={popoverContent}>
        <Button size="small">
          <Icon icon={faTag} />
          <span>{scene.tags.length}</span>
        </Button>
      </HoverPopover>
    );
  }

  function maybeRenderPerformerPopoverButton(scene: GQL.SlimSceneDataFragment) {
    if (scene.performers.length <= 0) return;

    return <PerformerPopoverButton performers={scene.performers} />;
  }

  function maybeRenderGroupPopoverButton(scene: GQL.SlimSceneDataFragment) {
    if (scene.groups.length <= 0) return;

    const popoverContent = scene.groups.map((sceneGroup) => (
      <div className="group-tag-container flex flex-wrap" key={sceneGroup.group.id}>
        <Link
          to={`/groups/${sceneGroup.group.id}`}
          className="group-tag flex-1 m-auto zoom-2"
        >
          <img
            className="image-thumbnail"
            alt={sceneGroup.group.name ?? ""}
            src={sceneGroup.group.front_image_path ?? ""}
          />
        </Link>
        <GroupLink
          key={sceneGroup.group.id}
          group={sceneGroup.group}
          className="block"
        />
      </div>
    ));

    return (
      <HoverPopover
        placement="bottom"
        content={popoverContent}
        className="tag-tooltip"
      >
        <Button size="small">
          <Icon icon={faFilm} />
          <span>{scene.groups.length}</span>
        </Button>
      </HoverPopover>
    );
  }

  function maybeRenderSceneMarkerPopoverButton(
    scene: GQL.SlimSceneDataFragment
  ) {
    if (scene.scene_markers.length <= 0) return;

    const popoverContent = scene.scene_markers.map((marker) => {
      const markerWithScene = { ...marker, scene: { id: scene.id } };
      return <SceneMarkerLink key={marker.id} marker={markerWithScene} />;
    });

    return (
      <HoverPopover placement="bottom" content={popoverContent}>
        <Button size="small">
          <Icon icon={faMapMarkerAlt} />
          <span>{scene.scene_markers.length}</span>
        </Button>
      </HoverPopover>
    );
  }

  function maybeRenderOCounter(scene: GQL.SlimSceneDataFragment) {
    if (scene.o_counter) {
      return (
        <div>
          <Button size="small">
            <span className="fa-icon">
              <SweatDrops />
            </span>
            <span>{scene.o_counter}</span>
          </Button>
        </div>
      );
    }
  }

  function maybeRenderGallery(scene: GQL.SlimSceneDataFragment) {
    if (scene.galleries.length <= 0) return;

    const popoverContent = scene.galleries.map((gallery) => (
      <GalleryLink key={gallery.id} gallery={gallery} />
    ));

    return (
      <HoverPopover placement="bottom" content={popoverContent}>
        <Button size="small">
          <Icon icon={faImages} />
          <span>{scene.galleries.length}</span>
        </Button>
      </HoverPopover>
    );
  }

  function maybeRenderFileCount(scene: GQL.SlimSceneDataFragment) {
    if (scene.files.length <= 1) return;

    const popoverContent = (
      <FormattedMessage
        id="files_amount"
        values={{ value: intl.formatNumber(scene.files.length ?? 0) }}
      />
    );

    return (
      <HoverPopover placement="bottom" content={popoverContent}>
        <Button size="small">
          <Icon icon={faFileAlt} />
          <span>{scene.files.length}</span>
        </Button>
      </HoverPopover>
    );
  }

  function maybeRenderOrganized(scene: GQL.SlimSceneDataFragment) {
    if (scene.organized) {
      return (
        <div>
          <Button size="small">
            <Icon icon={faBox} />
          </Button>
        </div>
      );
    }
  }

  function maybeRenderPopoverButtonGroup(scene: GQL.SlimSceneDataFragment) {
    if (
      scene.tags.length > 0 ||
      scene.performers.length > 0 ||
      scene.groups.length > 0 ||
      scene.scene_markers.length > 0 ||
      scene?.o_counter ||
      scene.galleries.length > 0 ||
      scene.files.length > 1 ||
      scene.organized
    ) {
      return (
        <>
          <ButtonGroup className="flex-wrap">
            {maybeRenderTagPopoverButton(scene)}
            {maybeRenderPerformerPopoverButton(scene)}
            {maybeRenderGroupPopoverButton(scene)}
            {maybeRenderSceneMarkerPopoverButton(scene)}
            {maybeRenderOCounter(scene)}
            {maybeRenderGallery(scene)}
            {maybeRenderFileCount(scene)}
            {maybeRenderOrganized(scene)}
          </ButtonGroup>
        </>
      );
    }
  }

  function renderPagination() {
    return (
      <Box display="flex" mt={2} mb={2} alignItems="center">
        <Typography variant="h6" className="mr-auto">
          <FormattedMessage
            id="dupe_check.found_sets"
            values={{ setCount: scenes.length }}
          />
        </Typography>
        {checkCount > 0 && (
          <ButtonGroup>
            <Tooltip title={intl.formatMessage({ id: "actions.edit" })}>
              <Button onClick={onEdit}>
                <Icon icon={faPencilAlt} />
              </Button>
            </Tooltip>
            <Tooltip title={intl.formatMessage({ id: "actions.delete" })}>
              <Button color="error" onClick={handleDeleteSelected}>
                <Icon icon={faTrash} />
              </Button>
            </Tooltip>
          </ButtonGroup>
        )}
        <Box ml={2}>
          <Pagination
            count={Math.ceil(scenes.length / currentPageSize)}
            page={currentPage}
            onChange={(e, newPage) => {
              setQuery({ page: newPage === 1 ? undefined : newPage });
              resetCheckboxSelection();
            }}
          />
        </Box>
        <FormControl size="small" sx={{ marginLeft: 2, minWidth: 80 }}>
          <Select
            value={currentPageSize}
            onChange={(e) => {
              const newVal = Number(e.target.value);
              setCurrentPageSize(newVal);
              setQuery({
                size:
                  newVal === 20
                    ? undefined
                    : newVal,
              });
              resetCheckboxSelection();
            }}
          >
            {pageOptions}
          </Select>
        </FormControl>
      </Box>
    );
  }

  function renderMergeDialog() {
    if (mergeScenes) {
      return (
        <SceneMergeModal
          scenes={mergeScenes}
          onClose={(mergedID?: string) => {
            setMergeScenes(undefined);
            if (mergedID) {
              // refresh
              refetch();
            }
          }}
          show
        />
      );
    }
  }

  function onMergeClicked(
    sceneGroup: GQL.SlimSceneDataFragment[],
    scene: GQL.SlimSceneDataFragment
  ) {
    const selected = scenes.flat().filter((s) => checkedScenes[s.id]);

    // if scenes in this group other than this scene are selected, then only
    // the selected scenes will be selected as source. Otherwise all other
    // scenes will be source
    let srcScenes =
      selected.filter((s) => {
        if (s === scene) return false;
        return sceneGroup.includes(s);
      }) ?? [];

    if (!srcScenes.length) {
      srcScenes = sceneGroup.filter((s) => s !== scene);
    }

    // insert subject scene to the front so that it is considered the destination
    srcScenes.unshift(scene);

    setMergeScenes(
      srcScenes.map((s) => {
        return {
          id: s.id,
          title: objectTitle(s),
        };
      })
    );
  }

  return (
    <Paper id="scene-duplicate-checker" className="w-full mx-auto" sx={{ p: 3 }}>
      <div className={CLASSNAME}>
        {deletingScenes && selectedScenes && (
          <DeleteScenesDialog
            selected={selectedScenes}
            onClose={onDeleteDialogClosed}
          />
        )}
        {renderMergeDialog()}
        {maybeRenderEdit()}
        <Typography variant="h4" gutterBottom>
          <FormattedMessage id="dupe_check.title" />
        </Typography>

        <Box mb={3}>
          <Grid container spacing={2} alignItems="center">
            <Grid>
              <Typography variant="subtitle1">
                <FormattedMessage id="dupe_check.search_accuracy_label" />
              </Typography>
            </Grid>
            <Grid>
              <FormControl size="small">
                <Select
                  value={hashDistance}
                  onChange={(e) =>
                    setQuery({
                      distance:
                        e.target.value === 0
                          ? undefined
                          : e.target.value,
                      page: undefined,
                    })
                  }
                >
                  <MenuItem value={0}>{intl.formatMessage({ id: "dupe_check.options.exact" })}</MenuItem>
                  <MenuItem value={4}>{intl.formatMessage({ id: "dupe_check.options.high" })}</MenuItem>
                  <MenuItem value={8}>{intl.formatMessage({ id: "dupe_check.options.medium" })}</MenuItem>
                  <MenuItem value={10}>{intl.formatMessage({ id: "dupe_check.options.low" })}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="textSecondary">
                <FormattedMessage id="dupe_check.description" />
              </Typography>
            </Grid>
          </Grid>

          <Grid container spacing={2} alignItems="center" sx={{ mt: 1 }}>
            <Grid>
              <Typography variant="subtitle1">
                <FormattedMessage id="dupe_check.duration_diff" />
              </Typography>
            </Grid>
            <Grid>
              <FormControl size="small">
                <Select
                  value={durationDiff}
                  onChange={(e) =>
                    setQuery({
                      durationDiff:
                        String(e.target.value) === defaultDurationDiff
                          ? undefined
                          : e.target.value,
                      page: undefined,
                    })
                  }
                >
                  <MenuItem value={-1}>{intl.formatMessage({ id: "dupe_check.duration_options.any" })}</MenuItem>
                  <MenuItem value={0}>{intl.formatMessage({ id: "dupe_check.duration_options.equal" })}</MenuItem>
                  <MenuItem value={1}>1 {intl.formatMessage({ id: "second" })}</MenuItem>
                  <MenuItem value={5}>5 {intl.formatMessage({ id: "seconds" })}</MenuItem>
                  <MenuItem value={10}>10 {intl.formatMessage({ id: "seconds" })}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Box>

        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
          <Box display="flex" alignItems="center" gap={2}>
            {Object.keys(checkedScenes).length > 0 && (
              <Typography variant="body2">
                <FormattedMessage
                  id="selected_count"
                  values={{ count: Object.keys(checkedScenes).length }}
                />
              </Typography>
            )}
            <Button
              variant="outlined"
              color="inherit"
              onClick={resetCheckboxSelection}
              disabled={Object.keys(checkedScenes).length === 0}
              size="small"
            >
              <FormattedMessage id="actions.deselect_all" />
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleDeleteSelected}
              disabled={Object.keys(checkedScenes).length === 0}
              size="small"
              startIcon={<Icon icon={faTrash} />}
            >
              <FormattedMessage id="actions.delete_selected" />
            </Button>
          </Box>
        </Box>

        <Box mb={3}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel id="select-options-label">
                  <FormattedMessage id="dupe_check.select_options" />
                </InputLabel>
                <Select
                  labelId="select-options-label"
                  label={<FormattedMessage id="dupe_check.select_options" />}
                  value=""
                  onChange={(e) => {
                    const val = e.target.value as string;
                    if (val === "none") resetCheckboxSelection();
                    if (val === "all_but_largest_res") onSelectLargestResolutionClick();
                    if (val === "all_but_largest_file") onSelectLargestClick();
                    if (val === "oldest") onSelectByAge(true);
                    if (val === "youngest") onSelectByAge(false);
                  }}
                  displayEmpty
                >
                  <MenuItem value="" disabled>
                    <FormattedMessage id="actions.select" />...
                  </MenuItem>
                  <MenuItem value="none">
                    <FormattedMessage id="dupe_check.select_none" />
                  </MenuItem>
                  <MenuItem value="all_but_largest_res">
                    <FormattedMessage id="dupe_check.select_all_but_largest_resolution" />
                  </MenuItem>
                  <MenuItem value="all_but_largest_file">
                    <FormattedMessage id="dupe_check.select_all_but_largest_file" />
                  </MenuItem>
                  <MenuItem value="oldest">
                    <FormattedMessage id="dupe_check.select_oldest" />
                  </MenuItem>
                  <MenuItem value="youngest">
                    <FormattedMessage id="dupe_check.select_youngest" />
                  </MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
          <Box mt={2} display="flex" flexDirection="column" gap={1}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={chkSameDuration}
                  onChange={(e) => {
                    setChkSameDuration(e.target.checked);
                    resetCheckboxSelection();
                  }}
                />
              }
              label={intl.formatMessage({
                id: "dupe_check.only_show_exact_duration_matches",
              })}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={chkSafeSelect}
                  onChange={(e) => {
                    setChkSafeSelect(e.target.checked);
                    resetCheckboxSelection();
                  }}
                />
              }
              label={intl.formatMessage({
                id: "dupe_check.only_select_matching_codecs",
              })}
            />
          </Box>
        </Box>

        {maybeRenderMissingPhashWarning()}
        {renderPagination()}

        <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox"></TableCell>
                <TableCell sx={{ width: 120 }}></TableCell>
                <TableCell><FormattedMessage id="details" /></TableCell>
                <TableCell></TableCell>
                <TableCell><FormattedMessage id="duration" /></TableCell>
                <TableCell><FormattedMessage id="filesize" /></TableCell>
                <TableCell><FormattedMessage id="resolution" /></TableCell>
                <TableCell><FormattedMessage id="bitrate" /></TableCell>
                <TableCell><FormattedMessage id="media_info.video_codec" /></TableCell>
                <TableCell><FormattedMessage id="actions" /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredScenes.map((group, groupIndex) =>
                group.map((scene, i) => {
                  const file = scene.files.length > 0 ? scene.files[0] : undefined;
                  const isGroupStart = i === 0 && groupIndex !== 0;

                  return (
                    <React.Fragment key={scene.id}>
                      {isGroupStart && (
                        <TableRow>
                          <TableCell colSpan={10} sx={{ height: 20, bgcolor: 'action.hover', border: 0 }} />
                        </TableRow>
                      )}
                      <TableRow
                        selected={!!checkedScenes[scene.id]}
                        sx={{
                          '&:last-child td, &:last-child th': { border: 0 },
                          bgcolor: i === 0 ? 'action.selected' : 'inherit'
                        }}
                      >
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={!!checkedScenes[scene.id]}
                            onChange={(e) => handleCheck(e.target.checked, scene.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <HoverPopover
                            content={
                              <img
                                src={scene.paths.sprite ?? ""}
                                alt=""
                                style={{ maxWidth: 600, width: '100%' }}
                              />
                            }
                            placement="right"
                          >
                            <img
                              src={scene.paths.sprite ?? ""}
                              alt=""
                              style={{
                                width: 100,
                                border: checkedScenes[scene.id] ? "2px solid red" : "none",
                                display: 'block'
                              }}
                            />
                          </HoverPopover>
                        </TableCell>
                        <TableCell>
                          <Link
                            to={`/scenes/${scene.id}`}
                            style={{
                              fontWeight: checkedScenes[scene.id] ? "bold" : "inherit",
                              textDecoration: checkedScenes[scene.id] ? "line-through" : "none",
                              textDecorationColor: checkedScenes[scene.id] ? "red" : "inherit",
                              color: 'inherit'
                            }}
                          >
                            {scene.title || TextUtils.fileNameFromPath(file?.path ?? "")}
                          </Link>
                          <Typography variant="caption" display="block" color="textSecondary" sx={{ wordBreak: 'break-all' }}>
                            {file?.path ?? ""}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {maybeRenderPopoverButtonGroup(scene)}
                        </TableCell>
                        <TableCell>
                          {file?.duration && TextUtils.secondsToTimestamp(file.duration)}
                        </TableCell>
                        <TableCell>
                          <FileSize size={file?.size ?? 0} />
                        </TableCell>
                        <TableCell>{`${file?.width ?? 0}x${file?.height ?? 0}`}</TableCell>
                        <TableCell>
                          <FormattedNumber value={(file?.bit_rate ?? 0) / 1000000} maximumFractionDigits={2} /> mbps
                        </TableCell>
                        <TableCell>{file?.video_codec ?? ""}</TableCell>
                        <TableCell>
                          <Box display="flex" flexDirection="column" gap={0.5}>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => handleDeleteScene(scene)}
                            >
                              <FormattedMessage id="actions.delete" />
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => onMergeClicked(group, scene)}
                            >
                              <FormattedMessage id="actions.merge" />
                            </Button>
                          </Box>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {scenes.length === 0 && (
          <Typography variant="h6" align="center" sx={{ mt: 4, color: 'text.secondary' }}>
            No duplicates found.
          </Typography>
        )}
        {renderPagination()}
      </div>
    </Paper>
  );
};

export default SceneDuplicateChecker;
