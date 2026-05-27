import React, { useMemo, useState } from "react";
import { Box, Grid, Typography } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { useGroupCreate } from "src/core/StashService";
import { useHistory, useLocation } from "react-router-dom";
import { useIntl } from "react-intl";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { useToast } from "src/hooks/Toast";
import { GroupEditPanel } from "./GroupEditPanel";

const GroupCreate: React.FC = () => {
  const history = useHistory();
  const intl = useIntl();
  const Toast = useToast();

  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location]);
  const group = {
    name: query.get("q") ?? undefined,
  };

  // Editing group state
  const [frontImage, setFrontImage] = useState<string | null>();
  const [backImage, setBackImage] = useState<string | null>();
  const [encodingImage, setEncodingImage] = useState<boolean>(false);

  const [createGroup] = useGroupCreate();

  async function onSave(input: GQL.GroupCreateInput) {
    const result = await createGroup({
      variables: { input },
    });
    if (result.data?.groupCreate?.id) {
      history.push(`/groups/${result.data.groupCreate.id}`);
      Toast.success(
        intl.formatMessage(
          { id: "toast.created_entity" },
          { entity: intl.formatMessage({ id: "group" }).toLocaleLowerCase() }
        )
      );
    }
  }

  function renderFrontImage() {
    if (frontImage) {
      return (
        <Box
          component="img"
          alt="Front Cover"
          src={frontImage}
          sx={{
            maxHeight: 420,
            maxWidth: 280,
            width: "auto",
            height: "auto",
            objectFit: "contain",
            borderRadius: 1,
            border: "1px solid #27272a",
            display: "block",
          }}
        />
      );
    }
  }

  function renderBackImage() {
    if (backImage) {
      return (
        <Box
          component="img"
          alt="Back Cover"
          src={backImage}
          sx={{
            maxHeight: 420,
            maxWidth: 280,
            width: "auto",
            height: "auto",
            objectFit: "contain",
            borderRadius: 1,
            border: "1px solid #27272a",
            display: "block",
          }}
        />
      );
    }
  }

  // TODO: CSS class
  return (
    <Grid container spacing={3} className="group-details">
      <Grid size={{ xs: 12, md: 4 }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1.5,
            p: 2,
            bgcolor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: 2,
          }}
        >
          <Typography variant="subtitle2" color="text.secondary">
            {intl.formatMessage({ id: "images" })}
          </Typography>
          {encodingImage ? (
            <LoadingIndicator
              message={intl.formatMessage({ id: "actions.encoding_image" })}
            />
          ) : (
            <Box
              sx={{
                display: "flex",
                gap: 2,
                justifyContent: "center",
                flexWrap: "wrap",
                minHeight: 56,
              }}
            >
              {renderFrontImage()}
              {renderBackImage()}
            </Box>
          )}
        </Box>
      </Grid>

      <Grid size={{ xs: 12, md: 8 }}>
        <GroupEditPanel
          group={group}
          onSubmit={onSave}
          onCancel={() => history.push("/groups")}
          onDelete={() => { }}
          setFrontImage={setFrontImage}
          setBackImage={setBackImage}
          setEncodingImage={setEncodingImage}
        />
      </Grid>
    </Grid>
  );
};

export default GroupCreate;
