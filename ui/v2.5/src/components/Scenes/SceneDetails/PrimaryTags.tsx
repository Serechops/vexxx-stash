import React from "react";
import { FormattedMessage } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import {
  Button,
  Chip,
  IconButton,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
} from "@mui/material";
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

  // Sort markers by time
  const sortedMarkers = [...sceneMarkers].sort((a, b) => a.seconds - b.seconds);

  return (
    <TableContainer component={Paper} elevation={0} sx={{ bgcolor: 'transparent', border: '1px solid', borderColor: 'divider' }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: 'action.hover' }}>
            <TableCell sx={{ fontWeight: 'bold', width: '100px', whiteSpace: 'nowrap' }}>
              <Box display="flex" alignItems="center" gap={0.5}>
                <AccessTimeIcon fontSize="inherit" />
                <FormattedMessage id="time" defaultMessage="Time" />
              </Box>
            </TableCell>
            <TableCell sx={{ fontWeight: 'bold', minWidth: '200px' }}>
              <FormattedMessage id="title" defaultMessage="Title" />
            </TableCell>
            <TableCell sx={{ fontWeight: 'bold', width: '150px' }}>
              <FormattedMessage id="primary_tag" defaultMessage="Primary Tag" />
            </TableCell>
            <TableCell sx={{ fontWeight: 'bold', minWidth: '150px' }}>
              <FormattedMessage id="tags" defaultMessage="Tags" />
            </TableCell>
            <TableCell align="right" sx={{ width: '50px' }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedMarkers.map((marker) => {
            const tags = marker.tags.map((tag) => (
              <Chip
                key={tag.id}
                label={tag.name}
                color="secondary"
                size="small"
                variant="outlined"
                sx={{ mr: 0.5, mb: 0.25 }}
              />
            ));

            return (
              <TableRow
                key={marker.id}
                hover
                sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
              >
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {TextUtils.formatTimestampRange(
                      marker.seconds,
                      marker.end_seconds ?? undefined
                    )}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Button
                    variant="text"
                    onClick={() => onClickMarker(marker)}
                    sx={{
                      textAlign: "left",
                      p: 0,
                      minWidth: 0,
                      justifyContent: "flex-start",
                      textTransform: 'none',
                      color: 'primary.main',
                      fontWeight: 600,
                      lineHeight: 1.2,
                      '&:hover': { textDecoration: 'underline', bgcolor: 'transparent' },
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                    }}
                  >
                    {markerTitle(marker) || <Typography variant="body2" color="text.disabled" component="span"><em>No Title</em></Typography>}
                  </Button>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Chip
                    label={marker.primary_tag.name}
                    size="small"
                    sx={{ fontWeight: 'bold' }}
                  />
                </TableCell>
                <TableCell>
                  <Box display="flex" flexWrap="wrap" alignItems="center">
                    {marker.tags.slice(0, 2).map((tag) => (
                      <Chip
                        key={tag.id}
                        label={tag.name}
                        color="secondary"
                        size="small"
                        variant="outlined"
                        sx={{ mr: 0.5, mb: 0.25, maxWidth: '100px' }}
                      />
                    ))}
                    {marker.tags.length > 2 && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5, whiteSpace: 'nowrap' }}>
                        +{marker.tags.length - 2}
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={() => onEdit(marker)}
                    title="Edit"
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
