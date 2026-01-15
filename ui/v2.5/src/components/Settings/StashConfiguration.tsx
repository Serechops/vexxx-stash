import { faEllipsisV } from "@fortawesome/free-solid-svg-icons";
import React, { useState } from "react";
import { Button, Grid, IconButton, Menu, MenuItem, Box, Typography } from "@mui/material";
import { FormattedMessage } from "react-intl";
import { Icon } from "src/components/Shared/Icon";
import * as GQL from "src/core/generated-graphql";
import { FolderSelectDialog } from "../Shared/FolderSelect/FolderSelectDialog";
import { BooleanSetting } from "./Inputs";
import { SettingSection } from "./SettingSection";

interface IStashProps {
  index: number;
  stash: GQL.StashConfig;
  onSave: (instance: GQL.StashConfig) => void;
  onEdit: () => void;
  onDelete: () => void;
}

const Stash: React.FC<IStashProps> = ({
  index,
  stash,
  onSave,
  onEdit,
  onDelete,
}) => {
  // eslint-disable-next-line
  const handleInput = (key: string, value: any) => {
    const newObj = {
      ...stash,
      [key]: value,
    };
    onSave(newObj);
  };

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const bgcolor = index % 2 === 1 ? 'action.hover' : 'inherit';

  return (
    <Grid container alignItems="center" sx={{ p: 1, bgcolor }}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
          {stash.path}
        </Typography>
      </Grid>
      <Grid size={{ xs: 4, md: 2 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ display: { md: 'none' } }}>
            <FormattedMessage id="videos" />
          </Typography>
          <BooleanSetting
            id={`stash-exclude-video-${index}`}
            checked={!stash.excludeVideo}
            onChange={(v) => handleInput("excludeVideo", !v)}
          />
        </Box>
      </Grid>
      <Grid size={{ xs: 4, md: 2 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ display: { md: 'none' } }}>
            <FormattedMessage id="images" />
          </Typography>
          <BooleanSetting
            id={`stash-exclude-image-${index}`}
            checked={!stash.excludeImage}
            onChange={(v) => handleInput("excludeImage", !v)}
          />
        </Box>
      </Grid>
      <Grid size={{ xs: 4, md: 1 }} display="flex" justifyContent="flex-end">
        <IconButton
          id={`stash-menu-${index}`}
          aria-controls={open ? 'stash-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          onClick={handleClick}
          size="small"
        >
          <Icon icon={faEllipsisV} />
        </IconButton>
        <Menu
          id="stash-menu"
          anchorEl={anchorEl}
          open={open}
          onClose={handleClose}
          MenuListProps={{
            'aria-labelledby': `stash-menu-${index}`,
          }}
        >
          <MenuItem onClick={() => { handleClose(); onEdit(); }}>
            <FormattedMessage id="actions.edit" />
          </MenuItem>
          <MenuItem onClick={() => { handleClose(); onDelete(); }}>
            <FormattedMessage id="actions.delete" />
          </MenuItem>
        </Menu>
      </Grid>
    </Grid>
  );
};

interface IStashConfigurationProps {
  stashes: GQL.StashConfig[];
  setStashes: (v: GQL.StashConfig[]) => void;
  modalProps?: any;
}

const StashConfiguration: React.FC<IStashConfigurationProps> = ({
  stashes,
  setStashes,
  modalProps,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | undefined>();

  function onEdit(index: number) {
    setEditingIndex(index);
  }

  function onDelete(index: number) {
    setStashes(stashes.filter((v, i) => i !== index));
  }

  function onNew() {
    setIsCreating(true);
  }

  const handleSave = (index: number, stash: GQL.StashConfig) =>
    setStashes(stashes.map((s, i) => (i === index ? stash : s)));

  return (
    <>
      {isCreating ? (
        <FolderSelectDialog
          onClose={(v) => {
            if (v)
              setStashes([
                ...stashes,
                {
                  path: v,
                  excludeVideo: false,
                  excludeImage: false,
                },
              ]);
            setIsCreating(false);
          }}
          modalProps={modalProps}
        />
      ) : undefined}

      {editingIndex !== undefined ? (
        <FolderSelectDialog
          defaultValue={stashes[editingIndex].path}
          onClose={(v) => {
            if (v)
              setStashes(
                stashes.map((vv, index) => {
                  if (index === editingIndex) {
                    return {
                      ...vv,
                      path: v,
                    };
                  }
                  return vv;
                })
              );
            setEditingIndex(undefined);
          }}
          modalProps={modalProps}
        />
      ) : undefined}

      <div className="content" id="stash-table">
        {stashes.length > 0 && (
          <Grid container sx={{ display: { xs: 'none', md: 'flex' }, borderBottom: 1, borderColor: 'divider', pb: 1, mb: 1 }}>
            <Grid size={{ md: 7 }}>
              <Typography variant="subtitle2"><FormattedMessage id="path" /></Typography>
            </Grid>
            <Grid size={{ md: 2 }}>
              <Typography variant="subtitle2"><FormattedMessage id="videos" /></Typography>
            </Grid>
            <Grid size={{ md: 2 }}>
              <Typography variant="subtitle2"><FormattedMessage id="images" /></Typography>
            </Grid>
          </Grid>
        )}
        {stashes.map((stash, index) => (
          <Stash
            key={stash.path}
            index={index}
            stash={stash}
            onSave={(s) => handleSave(index, s)}
            onEdit={() => onEdit(index)}
            onDelete={() => onDelete(index)}
          />
        ))}
        <Button className="mt-2" variant="contained" color="secondary" onClick={() => onNew()}>
          <FormattedMessage id="actions.add_directory" />
        </Button>
      </div>
    </>
  );
};

interface IStashSetting {
  value: GQL.StashConfigInput[];
  onChange: (v: GQL.StashConfigInput[]) => void;
  modalProps?: any;
}

export const StashSetting: React.FC<IStashSetting> = ({
  value,
  onChange,
  modalProps,
}) => {
  return (
    <SettingSection
      id="stashes"
      headingID="library"
      subHeadingID="config.general.directory_locations_to_your_content"
    >
      <StashConfiguration
        stashes={value}
        setStashes={(v) => onChange(v)}
        modalProps={modalProps}
      />
    </SettingSection>
  );
};

export default StashConfiguration;
