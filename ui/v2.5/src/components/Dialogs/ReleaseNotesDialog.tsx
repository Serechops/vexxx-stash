import React from "react";
import { Box, Typography } from "@mui/material";
import { ModalComponent } from "../Shared/Modal";
import { faCogs } from "@fortawesome/free-solid-svg-icons";
import { useIntl } from "react-intl";
import { MarkdownPage } from "../Shared/MarkdownPage";
import { IReleaseNotes } from "src/docs/en/ReleaseNotes";

interface IReleaseNotesDialog {
  notes: IReleaseNotes[];
  onClose: () => void;
}

export const ReleaseNotesDialog: React.FC<IReleaseNotesDialog> = ({
  notes,
  onClose,
}) => {
  const intl = useIntl();

  return (
    <ModalComponent
      show
      icon={faCogs}
      header={intl.formatMessage({ id: "release_notes" })}
      accept={{
        onClick: onClose,
        text: intl.formatMessage({ id: "actions.close" }),
      }}
    >
      <Box sx={{ m: -3 }}>
        {notes
          .map((n, i) => (
            <Box key={i} sx={{ m: 3 }}>
              <Typography variant="h4">{n.version}</Typography>
              <MarkdownPage page={n.content} />
            </Box>
          ))
          .reduce((accu, curr) => (
            <>
              {accu}
              <hr />
              {curr}
            </>
          ))}
      </Box>
    </ModalComponent>
  );
};

export default ReleaseNotesDialog;
