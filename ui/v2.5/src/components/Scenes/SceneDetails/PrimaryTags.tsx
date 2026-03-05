import React from "react";
import { FormattedMessage } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { Button, Chip, Card, CardContent, CardHeader, Grid, Typography, Divider, IconButton, Box } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import TextUtils from "src/utils/text";
import { markerTitle } from "src/core/markers";

interface IPrimaryTags {
  sceneMarkers: GQL.SceneMarkerDataFragment[];
  onClickMarker: (marker: GQL.SceneMarkerDataFragment) => void;
  onEdit: (marker: GQL.SceneMarkerDataFragment) => void;
}

export const PrimaryTags: React.FC<IPrimaryTags> = ({
  sceneMarkers,
  onClickMarker,
  onEdit,
}) => {
  if (!sceneMarkers?.length) return <div />;

  const primaryTagNames: Record<string, string> = {};
  const markersByTag: Record<string, GQL.SceneMarkerDataFragment[]> = {};
  sceneMarkers.forEach((m) => {
    if (primaryTagNames[m.primary_tag.id]) {
      markersByTag[m.primary_tag.id].push(m);
    } else {
      primaryTagNames[m.primary_tag.id] = m.primary_tag.name;
      markersByTag[m.primary_tag.id] = [m];
    }
  });

  const primaryCards = Object.keys(markersByTag).map((id) => {
    const markers = markersByTag[id].map((marker, index) => {
      const tags = marker.tags.map((tag) => (
        <Chip key={tag.id} label={tag.name} color="secondary" size="small" className="tag-item" />
      ));

      return (
        <React.Fragment key={marker.id}>
          {index > 0 && <Divider />}
          <Box sx={{ py: 1.5 }}>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2}>
              <Button
                variant="text"
                onClick={() => onClickMarker(marker)}
                sx={{
                  textAlign: "left",
                  p: 0,
                  minWidth: 0,
                  justifyContent: "flex-start",
                  wordBreak: "break-word"
                }}
              >
                {markerTitle(marker)}
              </Button>
              <IconButton
                size="small"
                onClick={() => onEdit(marker)}
                title="Edit"
                sx={{ flexShrink: 0, mt: -0.5 }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Box>

            <Box display="flex" alignItems="center" gap={0.5} mt={0.5} color="text.secondary">
              <AccessTimeIcon fontSize="small" />
              <Typography variant="body2">
                {TextUtils.formatTimestampRange(
                  marker.seconds,
                  marker.end_seconds ?? undefined
                )}
              </Typography>
            </Box>

            {tags.length > 0 && (
              <Box display="flex" flexWrap="wrap" gap={0.5} mt={1}>
                {tags}
              </Box>
            )}
          </Box>
        </React.Fragment>
      );
    });

    return (
      <Grid item xs={12} sm={6} xl={4} key={id}>
        <Card className="primary-card" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <CardHeader titleTypographyProps={{ variant: "h6" }} title={primaryTagNames[id]} sx={{ pb: 1 }} />
          <CardContent className="primary-card-body" sx={{ pt: 0, flexGrow: 1 }}>
            {markers}
          </CardContent>
        </Card>
      </Grid>
    );
  });

  return (
    <Grid container spacing={3} className="primary-tag">
      {primaryCards}
    </Grid>
  );
};
