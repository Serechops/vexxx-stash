import MoreVertIcon from "@mui/icons-material/MoreVert";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import React, { useState } from "react";
import {
  Box,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { AlertModal } from "src/components/Shared/Alert";
import { Counter } from "src/components/Shared/Counter";
import { DateInput } from "src/components/Shared/DateInput";
import { ModalComponent } from "src/components/Shared/Modal";
import {
  useSceneDecrementO,
  useSceneDecrementPlayCount,
  useSceneIncrementO,
  useSceneIncrementPlayCount,
  useSceneResetO,
  useSceneResetPlayCount,
  useSceneResetActivity,
} from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import { useConfigurationContext } from "src/hooks/Config";
import { useToast } from "src/hooks/Toast";
import TextUtils from "src/utils/text";

const History: React.FC<{
  history: string[];
  unknownDate?: string;
  onRemove: (date: string) => void;
  noneID: string;
}> = ({ history, unknownDate, noneID, onRemove }) => {
  const intl = useIntl();

  if (history.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        <FormattedMessage id={noneID} />
      </Typography>
    );
  }

  function renderDate(date: string) {
    if (date === unknownDate) {
      return intl.formatMessage({ id: "unknown_date" });
    }
    return TextUtils.formatDateTime(intl, date);
  }

  return (
    <Table size="small" sx={{ mb: 1 }}>
      <TableBody>
        {history.map((playdate, index) => (
          <TableRow key={index} hover>
            <TableCell sx={{ py: 0.25 }}>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {renderDate(playdate)}
              </Typography>
            </TableCell>
            <TableCell align="right" sx={{ py: 0.25, width: "1%" }}>
              <IconButton
                size="small"
                onClick={() => onRemove(playdate)}
                title={intl.formatMessage({ id: "actions.remove_date" })}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const HistoryMenu: React.FC<{
  hasHistory: boolean;
  showResetResumeDuration: boolean;
  onAddDate: () => void;
  onClearDates: () => void;
  resetResume: () => void;
  resetDuration: () => void;
}> = ({
  hasHistory,
  showResetResumeDuration,
  onAddDate,
  onClearDates,
  resetResume,
  resetDuration,
}) => {
    const intl = useIntl();
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    const paperRef = React.useRef<HTMLDivElement>(null);

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
      setAnchorEl(null);
    };

    React.useEffect(() => {
      if (!open) return;

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        const isClickOnMenu = paperRef.current && paperRef.current.contains(target);
        const isClickOnAnchor = anchorEl && anchorEl.contains(target);
        if (!isClickOnMenu && !isClickOnAnchor) {
          handleClose();
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open, anchorEl]);

    return (
      <>
        <IconButton
          onClick={handleClick}
          size="small"
          title={intl.formatMessage({ id: "operations" })}
          aria-controls={open ? 'history-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
        <Menu
          id="history-menu"
          anchorEl={anchorEl}
          open={open}
          onClose={handleClose}
          disableScrollLock
          hideBackdrop
          slotProps={{
            root: { sx: { pointerEvents: 'none' } },
            paper: { ref: paperRef, sx: { pointerEvents: 'auto' } },
          }}
          MenuListProps={{
            'aria-labelledby': 'history-button',
          }}
        >
          <MenuItem onClick={() => { handleClose(); onAddDate(); }}>
            <FormattedMessage id="actions.add_manual_date" />
          </MenuItem>
          {hasHistory && (
            <MenuItem onClick={() => { handleClose(); onClearDates(); }}>
              <FormattedMessage id="actions.clear_date_data" />
            </MenuItem>
          )}
          {showResetResumeDuration && (
            <MenuItem onClick={() => { handleClose(); resetResume(); }}>
              <FormattedMessage id="actions.reset_resume_time" />
            </MenuItem>
          )}
          {showResetResumeDuration && (
            <MenuItem onClick={() => { handleClose(); resetDuration(); }}>
              <FormattedMessage id="actions.reset_play_duration" />
            </MenuItem>
          )}
        </Menu>
      </>
    );
  };

const DatePickerModal: React.FC<{
  show: boolean;
  onClose: (t?: string) => void;
}> = ({ show, onClose }) => {
  const intl = useIntl();
  const [date, setDate] = React.useState<string>(
    TextUtils.dateTimeToString(new Date())
  );

  return (
    <ModalComponent
      show={show}
      header={<FormattedMessage id="actions.choose_date" />}
      accept={{
        onClick: () => onClose(date),
        text: intl.formatMessage({ id: "actions.confirm" }),
      }}
      cancel={{
        variant: "secondary",
        onClick: () => onClose(),
        text: intl.formatMessage({ id: "actions.cancel" }),
      }}
    >
      <div>
        <DateInput value={date} onValueChange={(d) => setDate(d)} isTime />
      </div>
    </ModalComponent>
  );
};

interface ISceneHistoryProps {
  scene: GQL.SceneDataFragment;
}

export const SceneHistoryPanel: React.FC<ISceneHistoryProps> = ({ scene }) => {
  const intl = useIntl();
  const Toast = useToast();

  const { configuration } = useConfigurationContext();
  const { sfwContentMode } = configuration.interface;

  const [dialogs, setDialogs] = React.useState({
    playHistory: false,
    oHistory: false,
    addPlay: false,
    addO: false,
  });

  function setDialogPartial(partial: Partial<typeof dialogs>) {
    setDialogs({ ...dialogs, ...partial });
  }

  const [incrementPlayCount] = useSceneIncrementPlayCount();
  const [decrementPlayCount] = useSceneDecrementPlayCount();
  const [clearPlayCount] = useSceneResetPlayCount();
  const [incrementOCount] = useSceneIncrementO(scene.id);
  const [decrementOCount] = useSceneDecrementO(scene.id);
  const [resetO] = useSceneResetO(scene.id);
  const [resetResume] = useSceneResetActivity(scene.id, true, false);
  const [resetDuration] = useSceneResetActivity(scene.id, false, true);

  function dateStringToISOString(time: string) {
    const date = TextUtils.stringToFuzzyDateTime(time);
    if (!date) return null;
    return date.toISOString();
  }

  function handleAddPlayDate(time?: string) {
    incrementPlayCount({
      variables: {
        id: scene.id,
        times: time ? [time] : undefined,
      },
    });
  }

  function handleDeletePlayDate(time: string) {
    decrementPlayCount({
      variables: {
        id: scene.id,
        times: time ? [time] : undefined,
      },
    });
  }

  function handleClearPlayDates() {
    setDialogPartial({ playHistory: false });
    clearPlayCount({
      variables: {
        id: scene.id,
      },
    });
  }

  function handleAddODate(time?: string) {
    incrementOCount({
      variables: {
        id: scene.id,
        times: time ? [time] : undefined,
      },
    });
  }

  function handleDeleteODate(time: string) {
    decrementOCount({
      variables: {
        id: scene.id,
        times: time ? [time] : undefined,
      },
    });
  }

  function handleClearODates() {
    setDialogPartial({ oHistory: false });
    resetO({
      variables: {
        id: scene.id,
      },
    });
  }

  async function handleResetResume() {
    try {
      await resetResume({
        variables: {
          id: scene.id,
          reset_resume: true,
          reset_duration: false,
        },
      });

      Toast.success(
        intl.formatMessage(
          { id: "toast.updated_entity" },
          {
            entity: intl.formatMessage({ id: "scene" }).toLocaleLowerCase(),
          }
        )
      );
    } catch (e) {
      Toast.error(e);
    }
  }

  async function handleResetDuration() {
    try {
      await resetDuration({
        variables: {
          id: scene.id,
          reset_resume: false,
          reset_duration: true,
        },
      });

      Toast.success(
        intl.formatMessage(
          { id: "toast.updated_entity" },
          {
            entity: intl.formatMessage({ id: "scene" }).toLocaleLowerCase(),
          }
        )
      );
    } catch (e) {
      Toast.error(e);
    }
  }

  function maybeRenderDialogs() {
    const clearHistoryMessageID = sfwContentMode
      ? "dialogs.clear_o_history_confirm_sfw"
      : "dialogs.clear_play_history_confirm";
    return (
      <>
        <AlertModal
          show={dialogs.playHistory}
          text={intl.formatMessage({
            id: "dialogs.clear_play_history_confirm",
          })}
          confirmButtonText={intl.formatMessage({ id: "actions.clear" })}
          onConfirm={() => handleClearPlayDates()}
          onCancel={() => setDialogPartial({ playHistory: false })}
        />
        <AlertModal
          show={dialogs.oHistory}
          text={intl.formatMessage({ id: clearHistoryMessageID })}
          confirmButtonText={intl.formatMessage({ id: "actions.clear" })}
          onConfirm={() => handleClearODates()}
          onCancel={() => setDialogPartial({ oHistory: false })}
        />
        {/* add conditions here so that date is generated correctly */}
        {dialogs.addPlay && (
          <DatePickerModal
            show
            onClose={(t) => {
              const tt = t ? dateStringToISOString(t) : null;
              if (tt) {
                handleAddPlayDate(tt);
              }
              setDialogPartial({ addPlay: false });
            }}
          />
        )}
        {dialogs.addO && (
          <DatePickerModal
            show
            onClose={(t) => {
              const tt = t ? dateStringToISOString(t) : null;
              if (tt) {
                handleAddODate(tt);
              }
              setDialogPartial({ addO: false });
            }}
          />
        )}
      </>
    );
  }

  const playHistory = (scene.play_history ?? []).filter(
    (h) => h != null
  ) as string[];
  const oHistory = (scene.o_history ?? []).filter((h) => h != null) as string[];

  const oHistoryMessageID = sfwContentMode ? "o_history_sfw" : "o_history";
  const noneMessageID = sfwContentMode
    ? "odate_recorded_no_sfw"
    : "odate_recorded_no";

  return (
    <Box>
      {maybeRenderDialogs()}

      {/* Play history section */}
      <Box sx={{ mb: 2 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1 }}
        >
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="subtitle1" fontWeight={600}>
              <FormattedMessage id="play_history" />
            </Typography>
            <Counter count={playHistory.length} hideZero />
          </Stack>
          <Stack direction="row" alignItems="center">
            <IconButton
              size="small"
              title={intl.formatMessage({ id: "actions.add_play" })}
              onClick={() => handleAddPlayDate()}
            >
              <AddIcon fontSize="small" />
            </IconButton>
            <HistoryMenu
              hasHistory={playHistory.length > 0}
              showResetResumeDuration={true}
              onAddDate={() => setDialogPartial({ addPlay: true })}
              onClearDates={() => setDialogPartial({ playHistory: true })}
              resetResume={() => handleResetResume()}
              resetDuration={() => handleResetDuration()}
            />
          </Stack>
        </Stack>

        <History
          history={playHistory ?? []}
          noneID="playdate_recorded_no"
          unknownDate={scene.created_at}
          onRemove={(t) => handleDeletePlayDate(t)}
        />

        {(scene.play_duration ?? 0) > 0 && (
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell
                  sx={{
                    color: "text.secondary",
                    whiteSpace: "nowrap",
                    width: "1%",
                    pr: 2,
                    py: 0.5,
                  }}
                >
                  <FormattedMessage id="media_info.play_duration" />
                </TableCell>
                <TableCell sx={{ py: 0.5 }}>
                  <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                    {TextUtils.secondsToTimestamp(scene.play_duration ?? 0)}
                  </Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Box>

      <Divider sx={{ mb: 2 }} />

      {/* O history section */}
      <Box>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1 }}
        >
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="subtitle1" fontWeight={600}>
              <FormattedMessage id={oHistoryMessageID} />
            </Typography>
            <Counter count={oHistory.length} hideZero />
          </Stack>
          <Stack direction="row" alignItems="center">
            <IconButton
              size="small"
              title={intl.formatMessage({ id: "actions.add_o" })}
              onClick={() => handleAddODate()}
            >
              <AddIcon fontSize="small" />
            </IconButton>
            <HistoryMenu
              hasHistory={oHistory.length > 0}
              showResetResumeDuration={false}
              onAddDate={() => setDialogPartial({ addO: true })}
              onClearDates={() => setDialogPartial({ oHistory: true })}
              resetResume={() => handleResetResume()}
              resetDuration={() => handleResetDuration()}
            />
          </Stack>
        </Stack>
        <History
          history={oHistory}
          noneID={noneMessageID}
          unknownDate={scene.created_at}
          onRemove={(t) => handleDeleteODate(t)}
        />
      </Box>
    </Box>
  );
};

export default SceneHistoryPanel;
