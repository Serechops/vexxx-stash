import React, { useState } from "react";
import { Button, Box, Typography, Stack } from "@mui/material";

import * as GQL from "src/core/generated-graphql";
import { useUpdatePerformer } from "../queries";
import PerformerModal from "../PerformerModal";
import { faTags } from "@fortawesome/free-solid-svg-icons";
import { mergeStashIDs } from "src/utils/stashbox";

interface IStashSearchResultProps {
  performer: GQL.SlimPerformerDataFragment;
  stashboxPerformers: GQL.ScrapedPerformerDataFragment[];
  endpoint: string;
  onPerformerTagged: (
    performer: Pick<GQL.SlimPerformerDataFragment, "id"> &
      Partial<Omit<GQL.SlimPerformerDataFragment, "id">>
  ) => void;
  excludedPerformerFields: string[];
}

// #4596 - remove any duplicate aliases or aliases that are the same as the performer's name
function cleanAliases(currentName: string, aliases: string[]) {
  const ret: string[] = [];
  aliases.forEach((alias) => {
    if (
      alias.toLowerCase() !== currentName.toLowerCase() &&
      !ret.find((r) => r.toLowerCase() === alias.toLowerCase())
    ) {
      ret.push(alias);
    }
  });

  return ret;
}

const StashSearchResult: React.FC<IStashSearchResultProps> = ({
  performer,
  stashboxPerformers,
  onPerformerTagged,
  excludedPerformerFields,
  endpoint,
}) => {
  const [modalPerformer, setModalPerformer] =
    useState<GQL.ScrapedPerformerDataFragment>();
  const [saveState, setSaveState] = useState<string>("");
  const [error, setError] = useState<{ message?: string; details?: string }>(
    {}
  );

  const updatePerformer = useUpdatePerformer();

  const handleSave = async (input: GQL.PerformerCreateInput) => {
    setError({});
    setSaveState("Saving performer");
    setModalPerformer(undefined);

    if (input.stash_ids?.length) {
      input.stash_ids = mergeStashIDs(performer.stash_ids, input.stash_ids);
    }

    if (input.alias_list) {
      input.alias_list = cleanAliases(performer.name, input.alias_list);
    }

    const updateData: GQL.PerformerUpdateInput = {
      ...input,
      id: performer.id,
    };

    const res = await updatePerformer(updateData);

    if (!res?.data?.performerUpdate)
      setError({
        message: `Failed to save performer "${performer.name}"`,
        details:
          res?.errors?.[0].message ===
            "UNIQUE constraint failed: performers.name"
            ? "Name already exists"
            : res?.errors?.[0].message,
      });
    else onPerformerTagged(performer);
    setSaveState("");
  };

  const performers = stashboxPerformers.map((p) => (
    <Button
      sx={{ alignItems: "center", display: "flex", overflow: "hidden", textAlign: "left", width: "50%" }}
      variant="text"
      key={p.remote_site_id}
      onClick={() => setModalPerformer(p)}
    >
      <Box component="img" src={(p.images ?? [])[0]} alt="" sx={{ height: 40, mr: "10px" }} loading="lazy" />
      <span>
        {p.name}
        {p.disambiguation && ` (${p.disambiguation})`}
      </span>
    </Button>
  ));

  return (
    <>
      {modalPerformer && (
        <PerformerModal
          closeModal={() => setModalPerformer(undefined)}
          modalVisible={modalPerformer !== undefined}
          performer={modalPerformer}
          onSave={handleSave}
          icon={faTags}
          header="Update Performer"
          excludedPerformerFields={excludedPerformerFields}
          endpoint={endpoint}
        />
      )}
      <Box sx={{ display: "flex", flexWrap: "wrap" }}>{performers}</Box>
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
