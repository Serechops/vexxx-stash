import React, { useState } from "react";
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
import { RatingSystem } from "src/components/Shared/Rating/RatingSystem";
import CloseIcon from "@mui/icons-material/Close";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import MovieOutlinedIcon from "@mui/icons-material/MovieOutlined";
import PhotoOutlinedIcon from "@mui/icons-material/PhotoOutlined";
import * as GQL from "src/core/generated-graphql";
import { FileSize } from "src/components/Shared/FileSize";
import { SceneAIReview } from "./SceneAIReview";
import type { PersistedSceneResult } from "./useStashTagStore";

interface IFileBrowserDetailsPanelProps {
  id: string;
  type: "scene" | "image" | "gallery";
  onClose: () => void;
  /** Returns AI result for a scene, or null if none. */
  getSceneResult?: (id: string) => PersistedSceneResult | null;
  /** Called after the user dismisses AI suggestions for a scene. */
  onSceneDismissed?: (id: string) => void;
  /** Called after tags are applied so the parent can refetch. */
  onApplied?: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, minHeight: 22 }}>
    <Typography
      sx={{
        minWidth: 72,
        flexShrink: 0,
        pt: 0.1,
        fontSize: "0.68rem",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        fontWeight: 700,
        color: "text.disabled",
        lineHeight: 1.6,
      }}
    >
      {label}
    </Typography>
    <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
  </Box>
);

const StarRating: React.FC<{ rating100: number | null | undefined }> = ({
  rating100,
}) => {
  if (!rating100) return <Typography variant="body2" color="text.disabled">—</Typography>;
  return (
    <RatingSystem
      value={rating100}
      disabled
      compact
    />
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
      <Link key={p.id} href={`/performers/${p.id}`} underline="none" sx={{ flexShrink: 0, textAlign: "center", width: 96 }}>
        <Box
          component="img"
          src={p.image_path ?? "/performer_placeholder.png"}
          alt={p.name}
          sx={{
            width: 96,
            height: 128,
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
            fontSize: "0.65rem",
          }}
        >
          {p.name}
        </Typography>
      </Link>
    ))}
  </Box>
);

// ─── Scene panel ─────────────────────────────────────────────────────────────

const SceneDetails: React.FC<{
  id: string;
  getSceneResult?: (id: string) => PersistedSceneResult | null;
  onSceneDismissed?: (id: string) => void;
  onApplied?: () => void;
}> = ({ id, getSceneResult, onSceneDismissed, onApplied }) => {
  const { data, loading, refetch } = GQL.useFileBrowserSceneDetailsQuery({
    variables: { id },
  });
  // Optimistic tag names added before refetch completes
  const [extraTagNames, setExtraTagNames] = useState<string[]>([]);
  const scene = data?.findScene;

  if (loading) return <CircularProgress size={24} sx={{ m: 2 }} />;
  if (!scene) return null;
  const file = scene.files[0];
  const aiResult = getSceneResult?.(id) ?? null;

  return (
    <Stack spacing={0}>
      {/* Preview */}
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
            sx={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
          />
        ) : (
          <Box
            component="img"
            src={scene.paths.screenshot!}
            alt=""
            sx={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
          />
        )
      )}

      <Box sx={{ px: 1.75, py: 1.25 }}>
        {/* Title */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.25, wordBreak: "break-word", lineHeight: 1.4 }}>
          {scene.title || file?.path.split(/[\\/]/).pop()}
        </Typography>

        {/* File technical info */}
        {file && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
              mb: 1.25,
              px: 1,
              py: 0.75,
              bgcolor: "action.hover",
              borderRadius: 1,
            }}
          >
            <DetailRow label="Path">
              <Tooltip title={file.path} placement="bottom-start" enterDelay={400}>
                <Typography variant="caption" noWrap sx={{ display: "block", maxWidth: "100%" }}>
                  {file.path}
                </Typography>
              </Tooltip>
            </DetailRow>
            <DetailRow label="Size">
              <Typography variant="caption"><FileSize size={file.size} /></Typography>
            </DetailRow>
            <DetailRow label="Res">
              <Typography variant="caption">{file.width}×{file.height}</Typography>
            </DetailRow>
            <DetailRow label="Dur">
              <Typography variant="caption">
                {Math.floor(file.duration / 60)}:{String(Math.floor(file.duration % 60)).padStart(2, "0")}
              </Typography>
            </DetailRow>
            <DetailRow label="Codec">
              <Typography variant="caption">{file.video_codec} · {Math.round(file.frame_rate)} fps</Typography>
            </DetailRow>
          </Box>
        )}

        {/* Content metadata */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
            mb: 1.25,
            px: 1,
            py: 0.75,
            bgcolor: "action.hover",
            borderRadius: 1,
          }}
        >
        <Stack spacing={0.75}>
          {scene.date && (
            <DetailRow label="Date">
              <Typography variant="body2">{scene.date}</Typography>
            </DetailRow>
          )}
          <DetailRow label="Rating"><StarRating rating100={scene.rating100} /></DetailRow>
          {scene.studio && (
            <DetailRow label="Studio">
              <Box
                component="a"
                href={`/studios/${scene.studio.id}`}
                sx={{ display: "inline-flex", alignItems: "center", textDecoration: "none", "&:hover": { opacity: 0.8 } }}
              >
                {scene.studio.image_path && !scene.studio.image_path.includes("default=true") ? (
                  <Box
                    component="img"
                    src={scene.studio.image_path}
                    alt={scene.studio.name}
                    sx={{ height: 40, maxWidth: 200, objectFit: "contain", display: "block", borderRadius: 0.5 }}
                  />
                ) : (
                  <Typography variant="body2" color="primary.main" sx={{ fontWeight: 500 }}>
                    {scene.studio.name}
                  </Typography>
                )}
              </Box>
            </DetailRow>
          )}
        </Stack>
        </Box>
          {scene.performers.length > 0 && (
            <>
              <Divider sx={{ my: 0.25 }} />
              <Typography sx={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, color: "text.disabled" }}>
                Cast
              </Typography>
              <PerformerCarousel performers={scene.performers} />
            </>
          )}
          {/* Tags — merge server tags with any optimistically-added ones */}
          {(scene.tags.length > 0 || extraTagNames.length > 0) && (
            <>
              <Divider sx={{ my: 0.25 }} />
              <Typography sx={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, color: "text.disabled" }}>
                Tags
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {scene.tags.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    size="small"
                    component="a"
                    href={`/tags/${t.id}`}
                    clickable
                    sx={{ fontSize: "0.72rem", height: 22 }}
                  />
                ))}
                {extraTagNames
                  .filter((n) => !scene.tags.some((t) => t.name.toLowerCase() === n.toLowerCase()))
                  .map((n) => (
                    <Chip
                      key={`extra-${n}`}
                      label={n}
                      size="small"
                      color="success"
                      variant="outlined"
                      sx={{ fontSize: "0.72rem", height: 22 }}
                    />
                  ))}
              </Box>
            </>
          )}
          {scene.details && (
            <DetailRow label="Description">
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.82rem" }}>
                {scene.details}
              </Typography>
            </DetailRow>
          )}

          {/* AI suggestions — visible only when a result exists and not dismissed */}
          {aiResult && (
            <SceneAIReview
              sceneId={id}
              existingTagNames={[
                ...scene.tags.map((t) => t.name),
                ...extraTagNames,
              ]}
              result={aiResult}
              onTagsApplied={(names) =>
                setExtraTagNames((prev) => [...new Set([...prev, ...names])])
              }
              onApplied={() => { refetch(); onApplied?.(); }}
              onDismiss={() => onSceneDismissed?.(id)}
            />
          )}
      </Box>
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
    <Stack spacing={0}>
      {/* Thumbnail */}
      {image.paths.thumbnail && (
        <Box
          component="img"
          src={image.paths.thumbnail}
          alt=""
          sx={{ width: "100%", objectFit: "contain", maxHeight: 160, bgcolor: "black", display: "block" }}
        />
      )}

      <Box sx={{ px: 1.75, py: 1.25 }}>
        {/* Title */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.25, wordBreak: "break-word", lineHeight: 1.4 }}>
          {image.title || imgFile?.path.split(/[\\/]/).pop()}
        </Typography>

        {/* File info */}
        {imgFile && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
              mb: 1.25,
              px: 1,
              py: 0.75,
              bgcolor: "action.hover",
              borderRadius: 1,
            }}
          >
            <DetailRow label="Path">
              <Tooltip title={imgFile.path} placement="bottom-start" enterDelay={400}>
                <Typography variant="caption" noWrap sx={{ display: "block" }}>{imgFile.path}</Typography>
              </Tooltip>
            </DetailRow>
            <DetailRow label="Size">
              <Typography variant="caption"><FileSize size={imgFile.size} /></Typography>
            </DetailRow>
            <DetailRow label="Dims">
              <Typography variant="caption">{imgFile.width}×{imgFile.height}</Typography>
            </DetailRow>
          </Box>
        )}

        {/* Metadata */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
            mb: 1.25,
            px: 1,
            py: 0.75,
            bgcolor: "action.hover",
            borderRadius: 1,
          }}
        >
        <Stack spacing={0.75}>
          <DetailRow label="Rating"><StarRating rating100={image.rating100} /></DetailRow>
          {image.studio && (
            <DetailRow label="Studio">
              <Box
                component="a"
                href={`/studios/${image.studio.id}`}
                sx={{ display: "inline-flex", alignItems: "center", textDecoration: "none", "&:hover": { opacity: 0.8 } }}
              >
                {image.studio.image_path && !image.studio.image_path.includes("default=true") ? (
                  <Box
                    component="img"
                    src={image.studio.image_path}
                    alt={image.studio.name}
                    sx={{ height: 40, maxWidth: 200, objectFit: "contain", display: "block", borderRadius: 0.5 }}
                  />
                ) : (
                  <Typography variant="body2" color="primary.main" sx={{ fontWeight: 500 }}>
                    {image.studio.name}
                  </Typography>
                )}
              </Box>
            </DetailRow>
          )}
        </Stack>
        </Box>
          {image.performers.length > 0 && (
            <>
              <Divider sx={{ my: 0.25 }} />
              <Typography sx={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, color: "text.disabled" }}>
                Cast
              </Typography>
              <PerformerCarousel performers={image.performers} />
            </>
          )}
          {image.tags.length > 0 && (
            <>
              <Divider sx={{ my: 0.25 }} />
              <Typography sx={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, color: "text.disabled" }}>
                Tags
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {image.tags.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    size="small"
                    component="a"
                    href={`/tags/${t.id}`}
                    clickable
                    sx={{ fontSize: "0.72rem", height: 22 }}
                  />
                ))}
              </Box>
            </>
          )}
      </Box>
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
    <Stack spacing={0}>
      {/* Cover */}
      {gallery.paths.cover && (
        <Box
          component="img"
          src={gallery.paths.cover}
          alt=""
          sx={{ width: "100%", objectFit: "contain", maxHeight: 160, bgcolor: "black", display: "block" }}
        />
      )}

      <Box sx={{ px: 1.75, py: 1.25 }}>
        {/* Title */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.25, wordBreak: "break-word", lineHeight: 1.4 }}>
          {gallery.title || file?.path.split(/[\\/]/).pop()}
        </Typography>

        {/* File info */}
        {file && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
              mb: 1.25,
              px: 1,
              py: 0.75,
              bgcolor: "action.hover",
              borderRadius: 1,
            }}
          >
            <DetailRow label="Path">
              <Tooltip title={file.path} placement="bottom-start" enterDelay={400}>
                <Typography variant="caption" noWrap sx={{ display: "block" }}>{file.path}</Typography>
              </Tooltip>
            </DetailRow>
            <DetailRow label="Size">
              <Typography variant="caption"><FileSize size={file.size} /></Typography>
            </DetailRow>
          </Box>
        )}

        {/* Metadata */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
            mb: 1.25,
            px: 1,
            py: 0.75,
            bgcolor: "action.hover",
            borderRadius: 1,
          }}
        >
        <Stack spacing={0.75}>
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
              <Box
                component="a"
                href={`/studios/${gallery.studio.id}`}
                sx={{ display: "inline-flex", alignItems: "center", textDecoration: "none", "&:hover": { opacity: 0.8 } }}
              >
                {gallery.studio.image_path && !gallery.studio.image_path.includes("default=true") ? (
                  <Box
                    component="img"
                    src={gallery.studio.image_path}
                    alt={gallery.studio.name}
                    sx={{ height: 40, maxWidth: 200, objectFit: "contain", display: "block", borderRadius: 0.5 }}
                  />
                ) : (
                  <Typography variant="body2" color="primary.main" sx={{ fontWeight: 500 }}>
                    {gallery.studio.name}
                  </Typography>
                )}
              </Box>
            </DetailRow>
          )}
        </Stack>
        </Box>
          {gallery.performers.length > 0 && (
            <>
              <Divider sx={{ my: 0.25 }} />
              <Typography sx={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, color: "text.disabled" }}>
                Cast
              </Typography>
              <PerformerCarousel performers={gallery.performers} />
            </>
          )}
          {gallery.tags.length > 0 && (
            <>
              <Divider sx={{ my: 0.25 }} />
              <Typography sx={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, color: "text.disabled" }}>
                Tags
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {gallery.tags.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    size="small"
                    component="a"
                    href={`/tags/${t.id}`}
                    clickable
                    sx={{ fontSize: "0.72rem", height: 22 }}
                  />
                ))}
              </Box>
            </>
          )}
      </Box>
    </Stack>
  );
};

// ─── Public panel component ──────────────────────────────────────────────────

export const FileBrowserDetailsPanel: React.FC<IFileBrowserDetailsPanelProps> = ({
  id,
  type,
  onClose,
  getSceneResult,
  onSceneDismissed,
  onApplied,
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
          px: 1.5,
          py: 0.75,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          {type === "scene" && <MovieOutlinedIcon sx={{ fontSize: 16, color: "text.secondary" }} />}
          {type === "image" && <PhotoOutlinedIcon sx={{ fontSize: 16, color: "text.secondary" }} />}
          {type === "gallery" && <CollectionsOutlinedIcon sx={{ fontSize: 16, color: "text.secondary" }} />}
          <Typography
            variant="caption"
            sx={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: "text.secondary" }}
          >
            {type === "scene" ? "Scene" : type === "image" ? "Image" : "Gallery"}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="close details">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Scrollable body */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {type === "scene" && (
          <SceneDetails
            id={id}
            getSceneResult={getSceneResult}
            onSceneDismissed={onSceneDismissed}
            onApplied={onApplied}
          />
        )}
        {type === "image" && <ImageDetails id={id} />}
        {type === "gallery" && <GalleryDetails id={id} />}
      </Box>
    </Box>
  );
};
