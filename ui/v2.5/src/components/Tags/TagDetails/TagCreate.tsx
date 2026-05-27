import React, { useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useTagCreate } from "src/core/StashService";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { useToast } from "src/hooks/Toast";
import { tagRelationHook } from "src/core/tags";
import { Box, Typography } from "@mui/material";
import { TagEditPanel } from "./TagEditPanel";

const TagCreate: React.FC = () => {
  const intl = useIntl();
  const history = useHistory();
  const Toast = useToast();

  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location]);
  const tag = {
    name: query.get("q") ?? undefined,
  };

  // Editing tag state
  const [image, setImage] = useState<string | null>();
  const [encodingImage, setEncodingImage] = useState<boolean>(false);

  const [createTag] = useTagCreate();

  async function onSave(input: GQL.TagCreateInput) {
    const oldRelations = {
      parents: [],
      children: [],
    };
    const result = await createTag({
      variables: { input },
    });
    if (result.data?.tagCreate?.id) {
      const created = result.data.tagCreate;
      tagRelationHook(created, oldRelations, {
        parents: created.parents,
        children: created.children,
      });
      history.push(`/tags/${created.id}`);
      Toast.success(
        intl.formatMessage(
          { id: "toast.created_entity" },
          { entity: intl.formatMessage({ id: "tag" }).toLocaleLowerCase() }
        )
      );
    }
  }

  function renderImage() {
    if (image) {
      return (
        <Box
          component="img"
          className="logo"
          alt=""
          src={image}
          sx={{
            maxHeight: 160,
            maxWidth: 300,
            width: "auto",
            height: "auto",
            objectFit: "contain",
            display: "block",
            mx: "auto",
            borderRadius: 1,
          }}
        />
      );
    }
  }

  return (
    <Box sx={{ display: "flex", justifyContent: "center", px: 2, py: 3 }}>
      <Box sx={{ width: "100%", maxWidth: 700, minHeight: "4rem" }}>
        <Box sx={{ textAlign: "center", mb: 2 }}>
          {encodingImage ? (
            <LoadingIndicator
              message={intl.formatMessage({ id: "actions.encoding_image" })}
            />
          ) : (
            renderImage()
          )}
        </Box>
        <TagEditPanel
          tag={tag}
          onSubmit={onSave}
          onCancel={() => history.push("/tags")}
          onDelete={() => {}}
          setImage={setImage}
          setEncodingImage={setEncodingImage}
        />
      </Box>
    </Box>
  );
};

export default TagCreate;
