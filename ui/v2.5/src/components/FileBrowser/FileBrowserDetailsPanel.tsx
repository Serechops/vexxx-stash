import React from "react";
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import * as GQL from "src/core/generated-graphql";
import { FileSize } from "src/components/Shared/FileSize";

interface IFileBrowserDetailsPanelProps {
  id: string;
  type: "scene" | "image" | "gallery";
  onClose: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <Box>
    <Typography variant="caption" color="text.secondary" display="block">
      {label}
    </Typography>
    <Box sx={{ mt: 0.25 }}>{children}</Box>
  </Box>
);

const StarRating: React.FC<{ rating100: number | null | undefined }> = ({
  rating100,
}) => {
  if (!rating100) return <Typography variant="body2" color="text.disabled">—</Typography>;
  const stars = Math.round(rating100 / 20);
  return (
    <Typography variant="body2" sx={{ letterSpacing: 1 }}>
      {"★".repeat(stars)}{"☆".repeat(5 - stars)}
      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
        ({rating100}/100)
      </Typography>
    </Typography>
  );
};

// ─── Scene panel ─────────────────────────────────────────────────────────────

const SceneDetails: React.FC<{ id: string }> = ({ id }) => {
  const { data, loading } = GQL.useFileBrowserSceneDetailsQuery({
    variables: { id },
  });
  const scene = data?.findScene;
  if (loading) return <CircularProgress size={24} sx={{ m: 2 }} />;
  if (!scene) return null;
  const file = scene.files[0];

  return (
    <Stack spacing={1.5}>
      {scene.paths.screenshot && (
        <Box
          component="img"
          src={scene.paths.screenshot}
          alt=""
          sx={{ width: "100%", aspectRatio: "16/9", objectFit: "cover" }}
        />
      )}
      <Stack spacing={1.5} sx={{ px: 2, pb: 2 }}>
        <Typography variant="subtitle2" fontWeight="bold" sx={{ wordBreak: "break-word" }}>
          {scene.title || file?.path.split(/[\\/]/).pop()}
        </Typography>
        <Divider />
        {file && (
          <>
            <DetailRow label="Path">
              <Tooltip title={file.path} placement="bottom-start" enterDelay={400}>
                <Typography variant="body2" noWrap sx={{ maxWidth: "100%" }}>
                  {file.path}
                </Typography>
              </Tooltip>
            </DetailRow>
            <DetailRow label="Size">
              <Typography variant="body2"><FileSize size={file.size} /></Typography>
            </DetailRow>
            <DetailRow label="Resolution">
              <Typography variant="body2">{file.width}×{file.height}</Typography>
            </DetailRow>
            <DetailRow label="Duration">
              <Typography variant="body2">
                {Math.floor(file.duration / 60)}:{String(Math.floor(file.duration % 60)).padStart(2, "0")}
              </Typography>
            </DetailRow>
            <DetailRow label="Video">
              <Typography variant="body2">{file.video_codec} · {Math.round(file.frame_rate)} fps</Typography>
            </DetailRow>
          </>
        )}
        {scene.date && (
          <DetailRow label="Date">
            <Typography variant="body2">{scene.date}</Typography>
          </DetailRow>
        )}
        <DetailRow label="Rating"><StarRating rating100={scene.rating100} /></DetailRow>
        {scene.studio && (
          <DetailRow label="Studio">
            <Link href={`/studios/${scene.studio.id}`} underline="hover" variant="body2">
              {scene.studio.name}
            </Link>
          </DetailRow>
        )}
        {scene.performers.length > 0 && (
          <DetailRow label="Performers">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.25 }}>
              {scene.performers.map((p) => (
                <Chip key={p.id} label={p.name} size="small" component="a" href={`/performers/${p.id}`} clickable />
              ))}
            </Box>
          </DetailRow>
        )}
        {scene.tags.length > 0 && (
          <DetailRow label="Tags">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.25 }}>
              {scene.tags.map((t) => (
                <Chip key={t.id} label={t.name} size="small" variant="outlined" />
              ))}
            </Box>
          </DetailRow>
        )}
        {scene.details && (
          <DetailRow label="Details">
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {scene.details}
            </Typography>
          </DetailRow>
        )}
      </Stack>
    </Stack>
  );
};

// ─── Image panel ─────────────────────────────────────────────────────────────

const ImageDetails: React.FC<{ id: string }> = ({ id }) => {
  const { data, loading } = GQL.useFileBrowserImageDetailsQuery({
    variables: { id },
  });
  const image = data?.findImage;
  if (loading) return <CircularProgress size={24} sx={{ m: 2 }} />;
  if (!image) return null;
  const file = image.visual_files[0];
  const imgFile = file && "width" in file ? file : null;

  return (
    <Stack spacing={1.5}>
      {image.paths.thumbnail && (
        <Box
          component="img"
          src={image.paths.thumbnail}
          alt=""
          sx={{ width: "100%", objectFit: "contain", maxHeight: 200, bgcolor: "black" }}
        />
      )}
      <Stack spacing={1.5} sx={{ px: 2, pb: 2 }}>
        <Typography variant="subtitle2" fontWeight="bold" sx={{ wordBreak: "break-word" }}>
          {image.title || imgFile?.path.split(/[\\/]/).pop()}
        </Typography>
        <Divider />
        {imgFile && (
          <>
            <DetailRow label="Path">
              <Tooltip title={imgFile.path} placement="bottom-start" enterDelay={400}>
                <Typography variant="body2" noWrap>{imgFile.path}</Typography>
              </Tooltip>
            </DetailRow>
            <DetailRow label="Size">
              <Typography variant="body2"><FileSize size={imgFile.size} /></Typography>
            </DetailRow>
            <DetailRow label="Dimensions">
              <Typography variant="body2">{imgFile.width}×{imgFile.height}</Typography>
            </DetailRow>
          </>
        )}
        <DetailRow label="Rating"><StarRating rating100={image.rating100} /></DetailRow>
        {image.studio && (
          <DetailRow label="Studio">
            <Link href={`/studios/${image.studio.id}`} underline="hover" variant="body2">
              {image.studio.name}
            </Link>
          </DetailRow>
        )}
        {image.performers.length > 0 && (
          <DetailRow label="Performers">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.25 }}>
              {image.performers.map((p) => (
                <Chip key={p.id} label={p.name} size="small" component="a" href={`/performers/${p.id}`} clickable />
              ))}
            </Box>
          </DetailRow>
        )}
        {image.tags.length > 0 && (
          <DetailRow label="Tags">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.25 }}>
              {image.tags.map((t) => (
                <Chip key={t.id} label={t.name} size="small" variant="outlined" />
              ))}
            </Box>
          </DetailRow>
        )}
      </Stack>
    </Stack>
  );
};

// ─── Gallery panel ───────────────────────────────────────────────────────────

const GalleryDetails: React.FC<{ id: string }> = ({ id }) => {
  const { data, loading } = GQL.useFileBrowserGalleryDetailsQuery({
    variables: { id },
  });
  const gallery = data?.findGallery;
  if (loading) return <CircularProgress size={24} sx={{ m: 2 }} />;
  if (!gallery) return null;
  const file = gallery.files[0];

  return (
    <Stack spacing={1.5}>
      {gallery.paths.cover && (
        <Box
          component="img"
          src={gallery.paths.cover}
          alt=""
          sx={{ width: "100%", objectFit: "contain", maxHeight: 200, bgcolor: "black" }}
        />
      )}
      <Stack spacing={1.5} sx={{ px: 2, pb: 2 }}>
        <Typography variant="subtitle2" fontWeight="bold" sx={{ wordBreak: "break-word" }}>
          {gallery.title || file?.path.split(/[\\/]/).pop()}
        </Typography>
        <Divider />
        {file && (
          <>
            <DetailRow label="Path">
              <Tooltip title={file.path} placement="bottom-start" enterDelay={400}>
                <Typography variant="body2" noWrap>{file.path}</Typography>
              </Tooltip>
            </DetailRow>
            <DetailRow label="Size">
              <Typography variant="body2"><FileSize size={file.size} /></Typography>
            </DetailRow>
          </>
        )}
        <DetailRow label="Images">
          <Typography variant="body2">{gallery.image_count}</Typography>
        </DetailRow>
        {gallery.date && (
          <DetailRow label="Date">
            <Typography variant="body2">{gallery.date}</Typography>
          </DetailRow>
        )}
        <DetailRow label="Rating"><StarRating rating100={gallery.rating100} /></DetailRow>
        {gallery.studio && (
          <DetailRow label="Studio">
            <Link href={`/studios/${gallery.studio.id}`} underline="hover" variant="body2">
              {gallery.studio.name}
            </Link>
          </DetailRow>
        )}
        {gallery.performers.length > 0 && (
          <DetailRow label="Performers">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.25 }}>
              {gallery.performers.map((p) => (
                <Chip key={p.id} label={p.name} size="small" component="a" href={`/performers/${p.id}`} clickable />
              ))}
            </Box>
          </DetailRow>
        )}
        {gallery.tags.length > 0 && (
          <DetailRow label="Tags">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.25 }}>
              {gallery.tags.map((t) => (
                <Chip key={t.id} label={t.name} size="small" variant="outlined" />
              ))}
            </Box>
          </DetailRow>
        )}
      </Stack>
    </Stack>
  );
};

// ─── Public panel component ──────────────────────────────────────────────────

export const FileBrowserDetailsPanel: React.FC<IFileBrowserDetailsPanelProps> = ({
  id,
  type,
  onClose,
}) => {
  return (
    <Box
      sx={{
        width: 300,
        flexShrink: 0,
        borderLeft: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary" fontWeight="medium">
          DETAILS
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="close details">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Scrollable body */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {type === "scene" && <SceneDetails id={id} />}
        {type === "image" && <ImageDetails id={id} />}
        {type === "gallery" && <GalleryDetails id={id} />}
      </Box>
    </Box>
  );
};
