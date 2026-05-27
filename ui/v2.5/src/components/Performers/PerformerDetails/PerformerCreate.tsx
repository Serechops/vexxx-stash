import React, { useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Box, Typography } from "@mui/material";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { PerformerEditPanel } from "./PerformerEditPanel";
import { useHistory, useLocation } from "react-router-dom";
import { useToast } from "src/hooks/Toast";
import * as GQL from "src/core/generated-graphql";
import { usePerformerCreate } from "src/core/StashService";

const PerformerCreate: React.FC = () => {
  const Toast = useToast();
  const history = useHistory();
  const intl = useIntl();

  const [image, setImage] = useState<string | null>();
  const [encodingImage, setEncodingImage] = useState<boolean>(false);

  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location]);
  const performer = {
    name: query.get("q") ?? undefined,
  };

  const [createPerformer] = usePerformerCreate();

  async function onSave(input: GQL.PerformerCreateInput) {
    const result = await createPerformer({
      variables: { input },
    });
    if (result.data?.performerCreate) {
      history.push(`/performers/${result.data.performerCreate.id}`);
      Toast.success(
        intl.formatMessage(
          { id: "toast.created_entity" },
          {
            entity: intl.formatMessage({ id: "performer" }).toLocaleLowerCase(),
          }
        )
      );
    }
  }

  function renderPerformerImage() {
    if (encodingImage) {
      return (
        <LoadingIndicator
          message={intl.formatMessage({ id: "actions.encoding_image" })}
        />
      );
    }
    if (image) {
      return (
        <Box
          component="img"
          className="performer"
          src={image}
          alt={intl.formatMessage({ id: "performer" })}
          sx={{
            maxHeight: 380,
            maxWidth: 260,
            width: "auto",
            height: "auto",
            objectFit: "contain",
            borderRadius: 2,
            display: "block",
          }}
        />
      );
    }
  }

  return (
    <Box
      sx={{ display: "flex", flexWrap: "wrap", gap: 3, px: 2, py: 3 }}
      id="performer-page"
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          width: { xs: "100%", md: "auto" },
          flexShrink: 0,
        }}
      >
        {renderPerformerImage()}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h5" gutterBottom>
          <FormattedMessage
            id="actions.create_entity"
            values={{ entityType: intl.formatMessage({ id: "performer" }) }}
          />
        </Typography>
        <PerformerEditPanel
          performer={performer}
          isVisible
          onSubmit={onSave}
          setImage={setImage}
          setEncodingImage={setEncodingImage}
        />
      </Box>
    </Box>
  );
};

export default PerformerCreate;
