import React, { useState, useEffect } from "react";
import { Button, Stack, Box, Divider, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { FormattedMessage } from "react-intl";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import { WallItem } from "src/components/Wall/WallItem";
import { PrimaryTags } from "./PrimaryTags";
import { SceneMarkerForm } from "./SceneMarkerForm";

interface ISceneMarkersPanelProps {
  sceneId: string;
  isVisible: boolean;
  onClickMarker: (marker: GQL.SceneMarkerDataFragment) => void;
}

export const SceneMarkersPanel: React.FC<ISceneMarkersPanelProps> = ({
  sceneId,
  isVisible,
  onClickMarker,
}) => {
  const { data, loading } = GQL.useFindSceneMarkerTagsQuery({
    variables: { id: sceneId },
  });
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [editingMarker, setEditingMarker] =
    useState<GQL.SceneMarkerDataFragment>();

  // set up hotkeys
  useEffect(() => {
    if (!isVisible) return;

    Mousetrap.bind("n", () => onOpenEditor());

    return () => {
      Mousetrap.unbind("n");
    };
  });

  if (loading) return null;

  function onOpenEditor(marker?: GQL.SceneMarkerDataFragment) {
    setIsEditorOpen(true);
    setEditingMarker(marker ?? undefined);
  }

  const closeEditor = () => {
    setEditingMarker(undefined);
    setIsEditorOpen(false);
  };

  if (isEditorOpen)
    return (
      <SceneMarkerForm
        sceneID={sceneId}
        marker={editingMarker}
        onClose={closeEditor}
      />
    );

  const sceneMarkers = (
    data?.sceneMarkerTags.map((tag) => tag.scene_markers) ?? []
  ).reduce((prev, current) => [...prev, ...current], []);

  return (
    <Stack spacing={3} className="scene-markers-panel">
      <Box display="flex" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => onOpenEditor()}>
          <FormattedMessage id="actions.create_marker" />
        </Button>
      </Box>
      <Box>
        <Typography variant="h6" sx={{ mb: 2 }}>
          <FormattedMessage id="markers" defaultMessage="Markers" />
        </Typography>
        <PrimaryTags
          sceneMarkers={sceneMarkers}
          onClickMarker={onClickMarker}
          onEdit={onOpenEditor}
        />
      </Box>
      {sceneMarkers.length > 0 && (
        <>
          <Divider />
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              <FormattedMessage id="marker_previews" defaultMessage="Marker Previews" />
            </Typography>
            <Stack spacing={2}>
              {sceneMarkers.map((marker, index) => (
                <Box key={marker.id} sx={{ width: '100%', borderRadius: 1, overflow: 'hidden' }}>
                  <WallItem
                    type="sceneMarker"
                    index={index}
                    data={marker}
                    className="transform-origin-center"
                    columns={1}
                    clickHandler={(e, m) => {
                      e.preventDefault();
                      window.scrollTo(0, 0);
                      onClickMarker(m as GQL.SceneMarkerDataFragment);
                    }}
                  />
                </Box>
              ))}
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
};

export default SceneMarkersPanel;
