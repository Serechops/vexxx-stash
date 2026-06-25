import React, { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Box, TextField, IconButton } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import SearchIcon from "@mui/icons-material/Search";

interface ISceneURLsCellProps {
  urls: string[];
  onSave: (urls: string[]) => void;
  urlScrapable: (url: string) => boolean;
  onScrape: (url: string) => void;
}

// Inline editable list of scene URLs for the scene list table. Commits changes
// on blur (when the value actually differs) so bulk URL edits don't fire a
// mutation on every keystroke. Mirrors the per-URL scrape affordance from the
// SceneEditPanel by exposing a scrape button next to each scrapable URL.
export const SceneURLsCell: React.FC<ISceneURLsCellProps> = ({
  urls,
  onSave,
  urlScrapable,
  onScrape,
}) => {
  const intl = useIntl();
  const [editing, setEditing] = useState<string[]>(urls);

  // keep local buffer in sync when the underlying scene updates externally
  useEffect(() => {
    setEditing(urls);
  }, [urls]);

  function commit(next: string[]) {
    const cleaned = next.map((u) => u.trim()).filter((u) => u !== "");
    if (JSON.stringify(cleaned) !== JSON.stringify(urls)) {
      onSave(cleaned);
    }
  }

  function setAt(i: number, value: string) {
    setEditing((prev) => prev.map((u, idx) => (idx === i ? value : u)));
  }

  function removeAt(i: number) {
    const next = editing.filter((_, idx) => idx !== i);
    setEditing(next);
    commit(next);
  }

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 240 }}
    >
      {editing.map((url, i) => (
        <Box
          key={i}
          sx={{ display: "flex", alignItems: "center", gap: 0.25 }}
        >
          <TextField
            fullWidth
            size="small"
            variant="standard"
            value={url}
            onChange={(e) => setAt(i, e.target.value)}
            onBlur={() => commit(editing)}
          />
          {urlScrapable(url) && (
            <IconButton
              size="small"
              title={intl.formatMessage({ id: "actions.scrape" })}
              onClick={() => onScrape(url)}
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton
            size="small"
            title={intl.formatMessage({ id: "actions.delete" })}
            onClick={() => removeAt(i)}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Box>
        <IconButton
          size="small"
          title={intl.formatMessage({ id: "actions.add" })}
          onClick={() => setEditing((prev) => [...prev, ""])}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
};

export default SceneURLsCell;
