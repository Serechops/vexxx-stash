import React, { useMemo, useState } from "react";
import { Button, Menu, MenuItem, Divider, Box } from "@mui/material";
import { useIntl } from "react-intl";
import { Icon } from "./Icon";
import { stashboxDisplayName } from "src/utils/stashbox";
import { ScraperSourceInput, StashBox } from "src/core/generated-graphql";
import { faSyncAlt } from "@fortawesome/free-solid-svg-icons";
import { ClearableInput } from "./ClearableInput";

export const ScraperMenu: React.FC<{
  toggle: React.ReactNode;
  variant?: string;
  stashBoxes?: StashBox[];
  scrapers: { id: string; name: string }[];
  onScraperClicked: (s: ScraperSourceInput) => void;
  onReloadScrapers: () => void;
}> = ({
  toggle,
  variant,
  stashBoxes,
  scrapers,
  onScraperClicked,
  onReloadScrapers,
}) => {
    const intl = useIntl();
    const [filter, setFilter] = useState("");
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    const menuRef = React.useRef<HTMLDivElement>(null);

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
      setAnchorEl(null);
    };

    // Manual click-away detection
    React.useEffect(() => {
      if (!open) return;

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        const menuPaper = menuRef.current;
        const isClickOnMenu = menuPaper && menuPaper.contains(target);
        const isClickOnAnchor = anchorEl && anchorEl.contains(target);

        if (!isClickOnMenu && !isClickOnAnchor) {
          handleClose();
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [open, anchorEl]);

    const filteredStashboxes = useMemo(() => {
      if (!stashBoxes) return [];
      if (!filter) return stashBoxes;

      return stashBoxes.filter((s) =>
        s.name.toLowerCase().includes(filter.toLowerCase())
      );
    }, [stashBoxes, filter]);

    const filteredScrapers = useMemo(() => {
      if (!filter) return scrapers;

      return scrapers.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.id.toLowerCase().includes(filter.toLowerCase())
      );
    }, [scrapers, filter]);

    return (
      <>
        <Button
          className="scraper-menu"
          title={intl.formatMessage({ id: "actions.scrape_query" })}
          onClick={handleClick}
          variant={variant === "secondary" ? "outlined" : "contained"}
          color="secondary"
          size="small"
        >
          {toggle}
        </Button>
        <Menu
          anchorEl={anchorEl}
          open={open}
          onClose={handleClose}
          disableScrollLock
          hideBackdrop
          slotProps={{
            root: {
              sx: { pointerEvents: 'none' },
              onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
            },
            paper: {
              ref: menuRef,
              sx: { pointerEvents: 'auto' }
            }
          }}
        >
          <Box className="scraper-filter-container" sx={{ p: 1, display: 'flex', gap: 1 }}>
            <ClearableInput
              placeholder={`${intl.formatMessage({ id: "filter" })}...`}
              value={filter}
              setValue={setFilter}
            />
            <Button
              onClick={onReloadScrapers}
              className="reload-button"
              title={intl.formatMessage({ id: "actions.reload_scrapers" })}
              variant="outlined"
              size="small"
            >
              <Icon icon={faSyncAlt} />
            </Button>
          </Box>

          {filteredStashboxes.map((s, index) => (
            <MenuItem
              key={s.endpoint}
              onClick={() => {
                onScraperClicked({
                  stash_box_endpoint: s.endpoint,
                });
                handleClose();
              }}
            >
              {stashboxDisplayName(s.name, index)}
            </MenuItem>
          ))}

          {filteredStashboxes.length > 0 && filteredScrapers.length > 0 && (
            <Divider />
          )}

          {filteredScrapers.map((s) => (
            <MenuItem
              key={s.name}
              onClick={() => {
                onScraperClicked({ scraper_id: s.id });
                handleClose();
              }}
            >
              {s.name}
            </MenuItem>
          ))}
        </Menu>
      </>
    );
  };
