/**
 * StashTag Integration for Scene Details
 *
 * AI-powered tag prediction using the cc1234/stashtag_onnx Hugging Face API.
 * Analyzes scene sprites and VTT files to suggest relevant tags.
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Chip,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Slider,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Alert,
  Grid,
  Divider,
  Switch,
  FormGroup,
  Avatar,
} from "@mui/material";
import {
  ExpandMore as ExpandMoreIcon,
  AutoFixHigh as AutoFixHighIcon,
  Label as LabelIcon,
  CheckCircle as CheckCircleIcon,
  Add as AddIcon,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import * as GQL from "src/core/generated-graphql";
import { useSceneUpdate, useTagCreate } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";

// Types
interface TagPrediction {
  label: string;
  prob: number;
  frame?: number;
  time?: number;
  offset?: number[];
}

interface StashTagResult {
  [key: string]: TagPrediction;
}

interface ProcessedTag {
  tag: {
    id: string;
    name: string;
  };
  confidence: number;
  frame: number;
  time: number;
  offset: number[];
  isTopResult: boolean;
}

/**
 * StashTag Backend Service
 * Uses local Go backend which invokes Python gradio_client
 */
class StashTagService {
  /**
   * Predict tags from a sprite image and VTT file
   * Uses local backend endpoint which calls cc1234/stashtag_onnx
   */
  static async predictTags(
    spriteUrl: string,
    vttContent: string,
    threshold: number = 0.4
  ): Promise<{ success: boolean; result?: StashTagResult; error?: string }> {
    try {
      // Fetch sprite image as blob and create form data
      const spriteResponse = await fetch(spriteUrl);
      if (!spriteResponse.ok) {
        throw new Error(`Failed to fetch sprite: ${spriteResponse.statusText}`);
      }
      const spriteBlob = await spriteResponse.blob();

      const formData = new FormData();
      formData.append("image", spriteBlob, "sprite.jpg");
      formData.append("vtt_content", vttContent);
      formData.append("threshold", threshold.toString());

      const response = await fetch("/stashtag/predict_tags", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error: ${response.status} ${errorText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Unknown error from StashTag service");
      }

      // Parse the result - it may be a JSON string or already parsed
      let parsedResult = result.result;
      if (typeof parsedResult === "string") {
        try {
          parsedResult = JSON.parse(parsedResult);
        } catch (e) {
          // Already parsed or not JSON
        }
      }

      return {
        success: true,
        result: parsedResult,
      };
    } catch (error: any) {
      console.error("StashTag API Error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Predict markers from a sprite image and VTT file
   * Uses local backend endpoint which calls cc1234/stashtag_onnx
   */
  static async predictMarkers(
    spriteUrl: string,
    vttContent: string,
    threshold: number = 0.4
  ): Promise<{ success: boolean; result?: StashTagResult; error?: string }> {
    try {
      // Fetch sprite image as blob and create form data
      const spriteResponse = await fetch(spriteUrl);
      if (!spriteResponse.ok) {
        throw new Error(`Failed to fetch sprite: ${spriteResponse.statusText}`);
      }
      const spriteBlob = await spriteResponse.blob();

      const formData = new FormData();
      formData.append("image", spriteBlob, "sprite.jpg");
      formData.append("vtt_content", vttContent);
      formData.append("threshold", threshold.toString());

      const response = await fetch("/stashtag/predict_markers", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error: ${response.status} ${errorText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Unknown error from StashTag service");
      }

      // Parse the result - it may be a JSON string or already parsed
      let parsedResult = result.result;
      if (typeof parsedResult === "string") {
        try {
          parsedResult = JSON.parse(parsedResult);
        } catch (e) {
          // Already parsed or not JSON
        }
      }

      return {
        success: true,
        result: parsedResult,
      };
    } catch (error: any) {
      console.error("StashTag API Error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check StashTag service status
   */
  static async checkStatus(): Promise<{ status: string; error?: string }> {
    try {
      const response = await fetch("/stashtag/status");
      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`);
      }
      return await response.json();
    } catch (error: any) {
      return { status: "unavailable", error: error.message };
    }
  }
}

/**
 * Tag Suggestion Card Component
 */
interface TagSuggestionProps {
  tag: { id: string; name: string };
  confidence: number;
  frame: number;
  time: number;
  offset: number[];
  spriteUrl: string;
  onAddToScene: (tagName: string) => Promise<void>;
  existingTagNames: string[];
  isTopResult: boolean;
}

const TagSuggestion: React.FC<TagSuggestionProps> = ({
  tag,
  confidence,
  frame,
  time,
  offset,
  spriteUrl,
  onAddToScene,
  existingTagNames,
  isTopResult,
}) => {
  const theme = useTheme();
  const [isAdding, setIsAdding] = useState(false);
  const [frameImageUrl, setFrameImageUrl] = useState<string | null>(null);

  const tagName = tag.name;
  const isAlreadyInScene = existingTagNames.includes(tagName.toLowerCase());

  const getConfidenceColor = (conf: number) => {
    if (conf >= 80) return theme.palette.success.main;
    if (conf >= 60) return theme.palette.warning.main;
    return theme.palette.error.main;
  };

  const getConfidenceBackground = (conf: number) => {
    if (conf >= 80) return "rgba(46, 125, 50, 0.15)";
    if (conf >= 60) return "rgba(237, 108, 2, 0.15)";
    return "rgba(211, 47, 47, 0.15)";
  };

  const formatTime = (seconds: number) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Extract frame from sprite sheet using offset coordinates
  const extractFrameFromSprite = useCallback(async () => {
    if (!spriteUrl || !offset || offset.length !== 4) return;

    try {
      const [x, y, width, height] = offset;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = width;
      canvas.height = height;

      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = spriteUrl;
      });

      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
      const frameDataUrl = canvas.toDataURL("image/jpeg", 0.8);
      setFrameImageUrl(frameDataUrl);
    } catch (error) {
      console.error("Failed to extract frame from sprite:", error);
    }
  }, [spriteUrl, offset]);

  useEffect(() => {
    extractFrameFromSprite();
  }, [extractFrameFromSprite]);

  const handleAddToScene = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isAdding || isAlreadyInScene || !onAddToScene) return;

    setIsAdding(true);
    try {
      await onAddToScene(tagName);
    } catch (error) {
      console.error("Error adding tag to scene:", error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Card
      sx={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 320,
        borderRadius: 2,
        overflow: "hidden",
        backgroundColor: isTopResult
          ? "rgba(25, 118, 210, 0.12)"
          : isAlreadyInScene
          ? "rgba(46, 125, 50, 0.08)"
          : getConfidenceBackground(confidence),
        border: isTopResult
          ? `2px solid ${theme.palette.primary.main}`
          : isAlreadyInScene
          ? `2px solid ${theme.palette.success.main}`
          : `1px solid ${theme.palette.divider}`,
        boxShadow: isTopResult
          ? `0 4px 20px rgba(25, 118, 210, 0.3)`
          : "0 2px 8px rgba(0, 0, 0, 0.15)",
        transition: "all 0.25s ease",
        "&:hover": {
          transform: "translateY(-4px)",
          boxShadow: isTopResult
            ? "0 8px 30px rgba(25, 118, 210, 0.4)"
            : "0 8px 24px rgba(0, 0, 0, 0.25)",
        },
      }}
    >
      {isTopResult && (
        <Box
          sx={{
            position: "absolute",
            top: 4,
            left: 4,
            backgroundColor: theme.palette.primary.main,
            color: "white",
            borderRadius: 1,
            px: 0.5,
            py: 0.25,
            fontSize: "0.65rem",
            fontWeight: 700,
            zIndex: 3,
          }}
        >
          🏆 TOP MATCH
        </Box>
      )}

      {isAlreadyInScene && (
        <Box
          sx={{
            position: "absolute",
            top: 4,
            right: 4,
            backgroundColor: theme.palette.success.main,
            color: "white",
            borderRadius: 1,
            px: 0.5,
            py: 0.25,
            fontSize: "0.65rem",
            fontWeight: 700,
            zIndex: 3,
          }}
        >
          ✓ ADDED
        </Box>
      )}

      {frameImageUrl ? (
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: 180,
            flexShrink: 0,
            background: `url(${frameImageUrl}) center/cover no-repeat`,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            p: 1.5,
          }}
        >
          <Box
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "60%",
              background:
                "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)",
              zIndex: 1,
            }}
          />

          {time > 0 && (
            <Box
              sx={{
                position: "relative",
                zIndex: 2,
                backgroundColor: "rgba(0,0,0,0.7)",
                borderRadius: 1,
                px: 1,
                py: 0.25,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  color: "white",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                {formatTime(time)}
              </Typography>
            </Box>
          )}
          <Box sx={{ flex: 1 }} />
        </Box>
      ) : (
        <Box
          sx={{
            height: 180,
            flexShrink: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(255,255,255,0.03)",
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          {offset && offset.length === 4 ? (
            <Box sx={{ textAlign: "center" }}>
              <CircularProgress size={24} />
              <Typography
                variant="body2"
                sx={{ mt: 1, color: "text.secondary", fontSize: "0.75rem" }}
              >
                Extracting frame...
              </Typography>
            </Box>
          ) : (
            <Typography
              variant="body2"
              sx={{ color: "text.secondary", fontSize: "0.75rem" }}
            >
              No preview available
            </Typography>
          )}
        </Box>
      )}

      <CardContent
        sx={{
          p: 2,
          pt: 1.5,
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <Box sx={{ mb: 1.5 }}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              color: theme.palette.text.primary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "1rem",
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            {tagName || "Unknown Tag"}
          </Typography>
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 1,
              mt: 0.5,
            }}
          >
            <Chip
              label={`${confidence}%`}
              size="small"
              sx={{
                backgroundColor: getConfidenceColor(confidence),
                color: "white",
                fontWeight: 700,
                fontSize: "0.7rem",
                height: 22,
              }}
            />
            {frame > 0 && (
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", fontSize: "0.7rem" }}
              >
                Frame {frame}
              </Typography>
            )}
          </Box>
        </Box>

        <Button
          size="small"
          variant={isAlreadyInScene ? "outlined" : "contained"}
          color={isAlreadyInScene ? "success" : "primary"}
          startIcon={
            isAdding ? (
              <CircularProgress size={14} color="inherit" />
            ) : isAlreadyInScene ? (
              <CheckCircleIcon />
            ) : (
              <AddIcon />
            )
          }
          onClick={handleAddToScene}
          disabled={isAdding || isAlreadyInScene}
          sx={{
            fontSize: "0.8rem",
            textTransform: "none",
            py: 1,
            borderRadius: 2,
            fontWeight: 600,
            width: "100%",
          }}
        >
          {isAlreadyInScene
            ? "Added"
            : isAdding
            ? "Adding..."
            : "Add to Scene"}
        </Button>
      </CardContent>
    </Card>
  );
};

/**
 * Main StashTag Identification Component
 */
interface StashTagIdentificationProps {
  scene: GQL.SceneDataFragment;
  onTagsFound?: (results: StashTagResult) => void;
}

export const StashTagIdentification: React.FC<StashTagIdentificationProps> = ({
  scene,
  onTagsFound,
}) => {
  const theme = useTheme();
  const Toast = useToast();
  const [isExpanded, setIsExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<StashTagResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // GraphQL hooks
  const [updateScene] = useSceneUpdate();
  const [createTag] = useTagCreate();

  // Filter settings
  const [threshold, setThreshold] = useState(0.4);
  const [endpoint, setEndpoint] = useState<"tags" | "markers">("tags");
  const [showLowConfidence, setShowLowConfidence] = useState(true);

  // Get existing tag names from the scene
  const existingTagNames = useMemo(() => {
    if (!scene?.tags) return [];
    return scene.tags.map((tag) => tag.name.toLowerCase());
  }, [scene?.tags]);

  // Check if scene has required files for analysis
  const canAnalyze = scene?.paths?.sprite && scene?.paths?.vtt;

  // Handle adding a tag to the scene
  const handleAddTagToScene = useCallback(
    async (tagName: string) => {
      if (!scene) {
        Toast.error("No scene available");
        return;
      }

      try {
        // First, try to find an existing tag with this name
        // We'll create if it doesn't exist
        let tagId: string | undefined;

        // Check if the tag already exists in scene tags
        const existingSceneTag = scene.tags.find(
          (t) => t.name.toLowerCase() === tagName.toLowerCase()
        );

        if (existingSceneTag) {
          Toast.success(`Tag "${tagName}" already exists in scene`);
          return;
        }

        // Try to create the tag (will fail gracefully if exists)
        try {
          const createResult = await createTag({
            variables: {
              input: { name: tagName },
            },
          });

          if (createResult.data?.tagCreate) {
            tagId = createResult.data.tagCreate.id;
          }
        } catch (createError: any) {
          // Tag might already exist, try to find it via the error or use a different approach
          console.log("Tag creation failed (may already exist):", createError);
          
          // If creation fails, we need to search for the existing tag
          // For now, we'll show an error suggesting manual addition
          Toast.error(
            `Could not create tag "${tagName}". It may already exist - try adding it manually from the edit panel.`
          );
          return;
        }

        if (!tagId) {
          Toast.error("Failed to create or find tag");
          return;
        }

        // Update scene with new tag
        const currentTagIds = scene.tags?.map((t) => t.id) || [];
        const updatedTagIds = [...currentTagIds, tagId];

        await updateScene({
          variables: {
            input: {
              id: scene.id,
              tag_ids: updatedTagIds,
            },
          },
        });

        Toast.success(`Added tag "${tagName}" to scene`);
      } catch (error: any) {
        console.error("Error adding tag to scene:", error);
        Toast.error(`Failed to add tag: ${error.message}`);
      }
    },
    [scene, updateScene, createTag, Toast]
  );

  const handleAnalyze = useCallback(async () => {
    if (!canAnalyze || loading || !scene?.paths?.sprite || !scene?.paths?.vtt) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      // Fetch VTT content
      const vttResponse = await fetch(scene.paths.vtt);
      if (!vttResponse.ok) {
        throw new Error("Failed to fetch VTT file");
      }
      const vttContent = await vttResponse.text();

      // Call StashTag API
      const response =
        endpoint === "tags"
          ? await StashTagService.predictTags(
              scene.paths.sprite,
              vttContent,
              threshold
            )
          : await StashTagService.predictMarkers(
              scene.paths.sprite,
              vttContent,
              threshold
            );

      if (response.success && response.result) {
        setResults(response.result);

        if (onTagsFound) {
          onTagsFound(response.result);
        }

        Toast.success("StashTag analysis completed successfully");
      } else {
        throw new Error(response.error || "Failed to analyze scene");
      }
    } catch (err: any) {
      console.error("StashTag analysis failed:", err);
      setError(err.message);
      Toast.error(`Analysis failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [scene, canAnalyze, threshold, endpoint, onTagsFound, Toast]);

  // Process results to extract tags with confidence scores
  const processedTags = useMemo((): ProcessedTag[] => {
    if (!results) return [];

    if (results && typeof results === "object" && !Array.isArray(results)) {
      const processedEntries = Object.entries(results)
        .map(([tagName, tagData], index) => {
          if (
            typeof tagData !== "object" ||
            (!tagData.prob && !(tagData as any).confidence)
          ) {
            return null;
          }

          const confidence = tagData.prob || (tagData as any).confidence || 0;
          const label = tagData.label || tagName;

          return {
            tag: {
              id: `predicted_${label.replace(/\s+/g, "_").toLowerCase()}`,
              name: label,
            },
            confidence: Math.round(confidence * 100),
            frame: tagData.frame || 0,
            time: tagData.time || 0,
            offset: tagData.offset || [0, 0, 0, 0],
            isTopResult: index === 0,
          };
        })
        .filter((item): item is ProcessedTag => item !== null);

      return processedEntries
        .sort((a, b) => b.confidence - a.confidence)
        .map((item, index) => ({
          ...item,
          isTopResult: index === 0,
        }));
    }

    return [];
  }, [results]);

  // Filter tags based on confidence threshold
  const filteredTags = useMemo(() => {
    const minConfidence = threshold * 100;
    return processedTags.filter(
      (item) => showLowConfidence || item.confidence >= minConfidence
    );
  }, [processedTags, showLowConfidence, threshold]);

  const tagsFound = filteredTags.length;

  if (!canAnalyze) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        StashTag analysis requires sprite and VTT files. Generate these files
        first using the Operations menu.
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Accordion
        expanded={isExpanded}
        onChange={(_, expanded) => setIsExpanded(expanded)}
        sx={{
          backgroundColor: theme.palette.background.paper,
          borderRadius: 2,
          border: `1px solid ${theme.palette.divider}`,
          "&:before": { display: "none" },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{
            backgroundColor: theme.palette.action.hover,
            borderRadius: "8px 8px 0 0",
            minHeight: 56,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", width: "100%" }}>
            <AutoFixHighIcon sx={{ mr: 2, color: theme.palette.primary.main }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              StashTag AI Analysis
            </Typography>
            {tagsFound > 0 && (
              <Chip
                label={`${tagsFound} tag${tagsFound !== 1 ? "s" : ""} found`}
                size="small"
                color="primary"
                sx={{ ml: 2 }}
              />
            )}
            <Box sx={{ flexGrow: 1 }} />
          </Box>
        </AccordionSummary>

        <AccordionDetails sx={{ p: 3 }}>
          {/* Settings Panel */}
          <Box sx={{ mb: 3 }}>
            <Typography
              variant="h6"
              gutterBottom
              sx={{ display: "flex", alignItems: "center" }}
            >
              <AutoFixHighIcon sx={{ mr: 1 }} />
              Analysis Settings
            </Typography>

            <Divider sx={{ mb: 2 }} />

            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl component="fieldset">
                  <FormLabel component="legend">API Endpoint</FormLabel>
                  <RadioGroup
                    value={endpoint}
                    onChange={(e) =>
                      setEndpoint(e.target.value as "tags" | "markers")
                    }
                    row
                  >
                    <FormControlLabel
                      value="tags"
                      control={<Radio size="small" />}
                      label="Tags"
                    />
                    <FormControlLabel
                      value="markers"
                      control={<Radio size="small" />}
                      label="Markers"
                    />
                  </RadioGroup>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth>
                  <FormLabel>
                    Confidence Threshold: {(threshold * 100).toFixed(0)}%
                  </FormLabel>
                  <Slider
                    value={threshold}
                    onChange={(_, value) => setThreshold(value as number)}
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    marks={[
                      { value: 0.2, label: "20%" },
                      { value: 0.5, label: "50%" },
                      { value: 0.8, label: "80%" },
                    ]}
                    sx={{ mt: 1 }}
                  />
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12 }}>
                <FormGroup>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={showLowConfidence}
                        onChange={(e) => setShowLowConfidence(e.target.checked)}
                      />
                    }
                    label="Show low confidence predictions"
                  />
                </FormGroup>
              </Grid>
            </Grid>
          </Box>

          {/* Analysis Button */}
          <Box sx={{ mb: 3, textAlign: "center" }}>
            <Button
              variant="contained"
              onClick={handleAnalyze}
              disabled={loading || !canAnalyze}
              startIcon={
                loading ? <CircularProgress size={20} /> : <AutoFixHighIcon />
              }
              sx={{
                minWidth: 200,
                py: 1.5,
                fontSize: "1rem",
                fontWeight: 600,
              }}
            >
              {loading ? "Analyzing Scene..." : "Analyze with StashTag"}
            </Button>
            <Typography
              variant="caption"
              display="block"
              sx={{ mt: 1, color: "text.secondary" }}
            >
              Powered by cc1234/stashtag_onnx on Hugging Face
            </Typography>
          </Box>

          {/* Error Display */}
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              <Typography variant="body2">{error}</Typography>
            </Alert>
          )}

          {/* Results Display */}
          {filteredTags.length > 0 && scene?.paths?.sprite && (
            <Box>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 2,
                }}
              >
                <Typography
                  variant="h6"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    fontWeight: 600,
                  }}
                >
                  <LabelIcon sx={{ mr: 1, color: theme.palette.primary.main }} />
                  Suggested Tags
                </Typography>
                <Chip
                  label={`${tagsFound} found`}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              </Box>

              <Divider sx={{ mb: 3 }} />

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(2, 1fr)",
                  },
                  gap: 2,
                  maxHeight: "70vh",
                  overflowY: "auto",
                  pr: 1,
                  "&::-webkit-scrollbar": {
                    width: "8px",
                  },
                  "&::-webkit-scrollbar-track": {
                    backgroundColor: "rgba(0,0,0,0.1)",
                    borderRadius: "4px",
                  },
                  "&::-webkit-scrollbar-thumb": {
                    backgroundColor: theme.palette.primary.main,
                    borderRadius: "4px",
                    "&:hover": {
                      backgroundColor: theme.palette.primary.dark,
                    },
                  },
                }}
              >
                {filteredTags.map((item, index) => (
                  <TagSuggestion
                    key={index}
                    tag={item.tag}
                    confidence={item.confidence}
                    frame={item.frame}
                    time={item.time}
                    offset={item.offset}
                    spriteUrl={scene.paths.sprite!}
                    onAddToScene={handleAddTagToScene}
                    existingTagNames={existingTagNames}
                    isTopResult={item.isTopResult}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* No Results Message */}
          {results && filteredTags.length === 0 && (
            <Alert severity="info">
              No tags found above the confidence threshold. Try lowering the
              threshold or enabling low confidence predictions.
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};
