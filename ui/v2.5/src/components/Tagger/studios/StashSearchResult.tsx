import React, { useState } from "react";
import { Button, Box, Stack, Typography } from "@mui/material";

import * as GQL from "src/core/generated-graphql";
import { useUpdateStudio } from "../queries";
import StudioModal from "../scenes/StudioModal";
import { faTags } from "@fortawesome/free-solid-svg-icons";
import { useStudioCreate } from "src/core/StashService";
import { useIntl } from "react-intl";
import { apolloError } from "src/utils";
import { mergeStudioStashIDs } from "../utils";

interface IStashSearchResultProps {
  studio: GQL.SlimStudioDataFragment;
  stashboxStudios: GQL.ScrapedStudioDataFragment[];
  endpoint: string;
  onStudioTagged: (
    studio: Pick<GQL.SlimStudioDataFragment, "id"> &
      Partial<Omit<GQL.SlimStudioDataFragment, "id">>
  ) => void;
  excludedStudioFields: string[];
}

const StashSearchResult: React.FC<IStashSearchResultProps> = ({
  studio,
  stashboxStudios,
  onStudioTagged,
  excludedStudioFields,
  endpoint,
}) => {
  const intl = useIntl();

  const [modalStudio, setModalStudio] =
    useState<GQL.ScrapedStudioDataFragment>();
  const [saveState, setSaveState] = useState<string>("");
  const [error, setError] = useState<{ message?: string; details?: string }>(
    {}
  );

  const [createStudio] = useStudioCreate();
  const updateStudio = useUpdateStudio();

  function handleSaveError(name: string, message: string) {
    setError({
      message: intl.formatMessage(
        { id: "studio_tagger.failed_to_save_studio" },
        { studio: name }
      ),
      details:
        message === "UNIQUE constraint failed: studios.name"
          ? "Name already exists"
          : message,
    });
  }

  const handleSave = async (
    input: GQL.StudioCreateInput,
    parentInput?: GQL.StudioCreateInput
  ) => {
    setError({});
    setModalStudio(undefined);

    if (parentInput) {
      setSaveState("Saving parent studio");

      try {
        // if parent id is set, then update the existing studio
        if (input.parent_id) {
          const parentUpdateData: GQL.StudioUpdateInput = {
            ...parentInput,
            id: input.parent_id,
          };

          parentUpdateData.stash_ids = await mergeStudioStashIDs(
            input.parent_id,
            parentInput.stash_ids ?? []
          );

          await updateStudio(parentUpdateData);
        } else {
          const parentRes = await createStudio({
            variables: { input: parentInput },
          });
          input.parent_id = parentRes.data?.studioCreate?.id;
        }
      } catch (e) {
        handleSaveError(parentInput.name, apolloError(e));
      }
    }

    setSaveState("Saving studio");
    const updateData: GQL.StudioUpdateInput = {
      ...input,
      id: studio.id,
    };

    updateData.stash_ids = await mergeStudioStashIDs(
      studio.id,
      input.stash_ids ?? []
    );

    const res = await updateStudio(updateData);

    if (!res?.data?.studioUpdate)
      handleSaveError(studio.name, res?.errors?.[0]?.message ?? "");
    else onStudioTagged(studio);
    setSaveState("");
  };

  const studios = stashboxStudios.map((p) => (
    <Button
      sx={{ alignItems: "center", display: "flex", overflow: "hidden", textAlign: "left", width: "50%" }}
      variant="text"
      key={p.remote_site_id}
      onClick={() => setModalStudio(p)}
    >
      <Box
        component="img"
        loading="lazy"
        src={(p.image ?? [])[0]}
        alt=""
        sx={{ height: 40, mr: "10px" }}
      />
      <span>{p.name}</span>
    </Button>
  ));

  return (
    <>
      {modalStudio && (
        <StudioModal
          closeModal={() => setModalStudio(undefined)}
          modalVisible={modalStudio !== undefined}
          studio={modalStudio}
          handleStudioCreate={handleSave}
          icon={faTags}
          header="Update Studio"
          excludedStudioFields={excludedStudioFields}
          endpoint={endpoint}
        />
      )}
      <Box sx={{ display: "flex", flexWrap: "wrap" }}>{studios}</Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", mt: 1, alignItems: "center", justifyContent: "flex-end" }}>
        {error.message && (
          <Box sx={{ textAlign: "right", mt: 0.5 }} style={{ color: '#db3737' }}>
            <strong>
              <Box component="span" sx={{ mr: 1 }}>Error:</Box>
              {error.message}
            </strong>
            <div>{error.details}</div>
          </Box>
        )}
        {saveState && (
          <Box component="strong" sx={{ mt: 0.5, mr: 1, textAlign: "right", width: "33.33%" }}>{saveState}</Box>
        )}
      </Box>
    </>
  );
};

export default StashSearchResult;
