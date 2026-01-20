import { faCheck, faList, faTimes } from "@fortawesome/free-solid-svg-icons";
import React, { useState } from "react";
import { Button, Grid, Typography } from "@mui/material";
import { useIntl } from "react-intl";

import { ModalComponent } from "../../Shared/Modal";
import { Icon } from "../../Shared/Icon";
import { STUDIO_FIELDS } from "../constants";

interface IProps {
  show: boolean;
  excludedFields: string[];
  onSelect: (fields: string[]) => void;
}

const StudioFieldSelect: React.FC<IProps> = ({
  show,
  excludedFields,
  onSelect,
}) => {
  const intl = useIntl();
  const [excluded, setExcluded] = useState<Record<string, boolean>>(
    // filter out fields that aren't in STUDIO_FIELDS
    excludedFields
      .filter((field) => STUDIO_FIELDS.includes(field))
      .reduce((dict, field) => ({ ...dict, [field]: true }), {})
  );

  const toggleField = (field: string) =>
    setExcluded({
      ...excluded,
      [field]: !excluded[field],
    });

  const renderField = (field: string) => (
    <Grid size={{ xs: 6 }} key={field} className="field-selector-row">
      <Button
        onClick={() => toggleField(field)}
        variant="outlined"
        color={excluded[field] ? "inherit" : "success"}
        size="small"
        className="field-selector-toggle-btn"
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
      dialogClassName="FieldSelect"
      accept={{
        text: intl.formatMessage({ id: "actions.save" }),
        onClick: () =>
          onSelect(Object.keys(excluded).filter((f) => excluded[f])),
      }}
    >
      <Typography variant="h6" gutterBottom>Select tagged fields</Typography>
      <Typography variant="body2" className="config-helper-text">
        These fields will be tagged by default. Click the button to toggle.
      </Typography>
      <Grid container>{STUDIO_FIELDS.map((f) => renderField(f))}</Grid>
    </ModalComponent>
  );
};

export default StudioFieldSelect;
