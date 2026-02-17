import { faCheck, faList, faTimes } from "@fortawesome/free-solid-svg-icons";
import React, { useState } from "react";
import { Button, Grid, Box, Typography } from "@mui/material";
import { useIntl } from "react-intl";

import { ModalComponent } from "../Shared/Modal";
import { Icon } from "../Shared/Icon";
import { PERFORMER_FIELDS } from "./constants";

interface IProps {
  show: boolean;
  excludedFields: string[];
  onSelect: (fields: string[]) => void;
}

const PerformerFieldSelect: React.FC<IProps> = ({
  show,
  excludedFields,
  onSelect,
}) => {
  const intl = useIntl();
  const [excluded, setExcluded] = useState<Record<string, boolean>>(
    excludedFields.reduce((dict, field) => ({ ...dict, [field]: true }), {})
  );

  const toggleField = (field: string) =>
    setExcluded({
      ...excluded,
      [field]: !excluded[field],
    });

  const renderField = (field: string) => (
    <Grid size={{ xs: 6 }} key={field} sx={{ mb: 1 }}>
      <Button
        onClick={() => toggleField(field)}
        variant="outlined"
        color={excluded[field] ? "inherit" : "success"}
        size="small"
        sx={{ mr: 1.5 }}
      >
        <Icon icon={excluded[field] ? faTimes : faCheck} />
      </Button>
      <span>{intl.formatMessage({ id: field })}</span>
    </Grid>
  );

  return (
    <ModalComponent
      show={show}
      icon={faList}
      accept={{
        text: intl.formatMessage({ id: "actions.save" }),
        onClick: () =>
          onSelect(Object.keys(excluded).filter((f) => excluded[f])),
      }}
    >
      <Typography variant="h6" gutterBottom>Select tagged fields</Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        These fields will be tagged by default. Click the button to toggle.
      </Typography>
      <Grid container>{PERFORMER_FIELDS.map((f) => renderField(f))}</Grid>
    </ModalComponent>
  );
};

export default PerformerFieldSelect;
