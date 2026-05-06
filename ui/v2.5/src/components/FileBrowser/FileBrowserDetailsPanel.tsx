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

const PerformerCarousel: React.FC<{
  performers: Array<{ id: string; name: string; image_path?: string | null }>;
}> = ({ performers }) => (
  <Box
    sx={{
      display: "flex",
      gap: 1,
      overflowX: "auto",
      mt: 0.5,
      pb: 0.5,
      scrollbarWidth: "thin",
      "&::-webkit-scrollbar": { height: 4 },
      "&::-webkit-scrollbar-thumb": { borderRadius: 2, bgcolor: "action.disabled" },
    }}
  >
    {performers.map((p) => (
      <Link key={p.id} href={`/performers/${p.id}`} underline="none" sx={{ flexShrink: 0, textAlign: "center", width: 72 }}>
        <Box
          component="img"
          src={p.image_path ?? "/performer_placeholder.png"}
          alt={p.name}
          sx={{
            width: 72,
            height: 96,
            borderRadius: 1,
            objectFit: "cover",
            objectPosition: "top",
            display: "block",
            border: "2px solid",
            borderColor: "divider",
            "&:hover": { borderColor: "primary.main" },
          }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: "block",
            mt: 0.25,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "0.6rem",
          }}
        >
          {p.name}
        </Typography>
      </Link>
    ))}
  </Box>
);

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
      {(scene.paths.preview || scene.paths.screenshot) && (
        scene.paths.preview ? (
          <Box
            component="video"
            src={scene.paths.preview}
            poster={scene.paths.screenshot ?? undefined}
            autoPlay
            loop
            muted
            playsInline
            sx={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }}
          />
        ) : (
          <Box
            component="img"
            src={scene.paths.screenshot!}
            alt=""
            sx={{ width: "100%", aspectRatio: "16/9", objectFit: "cover" }}
          />
        )
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
            <Link href={`/studios/${scene.studio.id}`} underline="none" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
              {scene.studio.image_path && !scene.studio.image_path.includes("default=true") ? (
                <Box component="img" src={scene.studio.image_path} alt={scene.studio.name} sx={{ height: 24, width: "auto", maxWidth: 120, objectFit: "contain", display: "block" }} />
              ) : (
                <Typography variant="body2" color="primary">{scene.studio.name}</Typography>
              )}
            </Link>
          </DetailRow>
        )}
        {scene.performers.length > 0 && (
          <DetailRow label="Performers">
            <PerformerCarousel performers={scene.performers} />
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
            <Link href={`/studios/${image.studio.id}`} underline="none" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
              {image.studio.image_path && !image.studio.image_path.includes("default=true") ? (
                <Box component="img" src={image.studio.image_path} alt={image.studio.name} sx={{ height: 24, width: "auto", maxWidth: 120, objectFit: "contain", display: "block" }} />
              ) : (
                <Typography variant="body2" color="primary">{image.studio.name}</Typography>
              )}
            </Link>
          </DetailRow>
        )}
        {image.performers.length > 0 && (
          <DetailRow label="Performers">
            <PerformerCarousel performers={image.performers} />
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
            <Link href={`/studios/${gallery.studio.id}`} underline="none" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
              {gallery.studio.image_path && !gallery.studio.image_path.includes("default=true") ? (
                <Box component="img" src={gallery.studio.image_path} alt={gallery.studio.name} sx={{ height: 24, width: "auto", maxWidth: 120, objectFit: "contain", display: "block" }} />
              ) : (
                <Typography variant="body2" color="primary">{gallery.studio.name}</Typography>
              )}
            </Link>
          </DetailRow>
        )}
        {gallery.performers.length > 0 && (
          <DetailRow label="Performers">
            <PerformerCarousel performers={gallery.performers} />
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
