import React, { useState } from "react";
import {
  Button,
  TextField,
  Popover,
  Box,
  Stack,
  InputLabel,
  Grid,
} from "@mui/material";
import { useIntl } from "react-intl";
import { ModalComponent } from "./Modal";
import { Icon } from "./Icon";
import { faFile, faLink } from "@fortawesome/free-solid-svg-icons";
import { PatchComponent } from "src/patch";
import { styled } from "@mui/material/styles";

interface IImageInput {
  isEditing: boolean;
  text?: string;
  onImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onImageURL?: (url: string) => void;
  acceptSVG?: boolean;
}

function acceptExtensions(acceptSVG: boolean = false) {
  return `.jpg,.jpeg,.png,.webp,.gif${acceptSVG ? ",.svg" : ""}`;
}

const HiddenInput = styled('input')({
  display: 'none',
});

export const ImageInput: React.FC<IImageInput> = PatchComponent(
  "ImageInput",
  ({ isEditing, text, onImageChange, onImageURL, acceptSVG = false }) => {
    const [isShowDialog, setIsShowDialog] = useState(false);
    const [url, setURL] = useState("");
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const popoverRef = React.useRef<HTMLDivElement>(null);

    const intl = useIntl();

    if (!isEditing) return <div />;

    if (!onImageURL) {
      // just return the file input
      return (
        <label htmlFor="simple-image-input" className="image-input">
          <HiddenInput
            accept={acceptExtensions(acceptSVG)}
            id="simple-image-input"
            type="file"
            onChange={onImageChange}
          />
          <Button variant="outlined" component="span" color="secondary">
            {text ?? intl.formatMessage({ id: "actions.browse_for_image" })}
          </Button>
        </label>
      );
    }

    function showDialog() {
      setURL("");
      setIsShowDialog(true);
      setAnchorEl(null);
    }

    function onConfirmURL() {
      if (!onImageURL) {
        return;
      }

      setIsShowDialog(false);
      onImageURL(url);
    }

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
      setAnchorEl(null);
    };

    const open = Boolean(anchorEl);
    const id = open ? "set-image-popover" : undefined;

    // Manual click-away detection
    React.useEffect(() => {
      if (!open) return;

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        const popoverPaper = popoverRef.current;
        const isClickOnPopover = popoverPaper && popoverPaper.contains(target);
        const isClickOnAnchor = anchorEl && anchorEl.contains(target);

        if (!isClickOnPopover && !isClickOnAnchor) {
          handleClose();
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [open, anchorEl]);

    function renderDialog() {
      return (
        <ModalComponent
          show={!!isShowDialog}
          onHide={() => setIsShowDialog(false)}
          header={intl.formatMessage({ id: "dialogs.set_image_url_title" })}
          accept={{
            onClick: onConfirmURL,
            text: intl.formatMessage({ id: "actions.confirm" }),
          }}
        >
          <div className="dialog-content">
            <Grid container spacing={2} alignItems="center">
              <Grid size={{ xs: 3 }}>
                <InputLabel>
                  {intl.formatMessage({ id: "url" })}
                </InputLabel>
              </Grid>
              <Grid size={{ xs: 9 }}>
                <TextField
                  fullWidth
                  variant="outlined"
                  size="small"
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setURL(event.currentTarget.value)
                  }
                  value={url}
                  placeholder={intl.formatMessage({ id: "url" })}
                />
              </Grid>
            </Grid>
          </div>
        </ModalComponent>
      );
    }

    const popoverContent = (
      <Box p={2}>
        <Stack spacing={2} direction="column">
          <label htmlFor="popover-image-input">
            <HiddenInput
              accept={acceptExtensions(acceptSVG)}
              id="popover-image-input"
              type="file"
              onChange={onImageChange}
            />
            <Button
              variant="outlined"
              color="secondary"
              component="span"
              fullWidth
              startIcon={<Icon icon={faFile} className="fa-fw" />}
            >
              <Box component="span" sx={{ ml: 1 }}>{intl.formatMessage({ id: "actions.from_file" })}</Box>
            </Button>
          </label>

          <Button
            variant="text"
            onClick={showDialog}
            fullWidth
            startIcon={<Icon icon={faLink} className="fa-fw" />}
            color="inherit"
            sx={{ justifyContent: 'flex-start' }}
          >
            <Box component="span" sx={{ ml: 1 }}>{intl.formatMessage({ id: "actions.from_url" })}</Box>
          </Button>
        </Stack>
      </Box>
    );

    return (
      <>
        {renderDialog()}
        <Button
          variant="contained"
          color="secondary"
          className="mr-2"
          onClick={handleClick}
        >
          {text ?? intl.formatMessage({ id: "actions.set_image" })}
        </Button>
        <Popover
          id={id}
          open={open}
          anchorEl={anchorEl}
          onClose={handleClose}
          hideBackdrop
          slotProps={{
            root: {
              sx: { pointerEvents: 'none' },
              onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
            },
            paper: {
              ref: popoverRef,
              sx: { pointerEvents: 'auto' }
            }
          }}
          anchorOrigin={{
            vertical: "bottom",
            horizontal: "left",
          }}
          transformOrigin={{
            vertical: "top",
            horizontal: "left",
          }}
        >
          {popoverContent}
        </Popover>
      </>
    );
  }
);
