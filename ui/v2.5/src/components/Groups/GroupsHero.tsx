import React, { useCallback, useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";
import { Box } from "@mui/material";
import { keyframes } from "@emotion/react";
import { Play } from "lucide-react";
import { Carousel } from "../Shared/Carousel";

// Slow, continuous drift on the backdrop so the frame is never fully static.
const kenBurns = keyframes`
  from { transform: scale(1.05); }
  to { transform: scale(1.18); }
`;

// Fill animation for the Netflix-style pacing segments.
const grow = keyframes`
  from { width: 0%; }
  to { width: 100%; }
`;

const ROTATE_MS = 8000;
const FADE_MS = 600;

// A scene tile that quietly autoplays its muted, looped preview as ambient
// motion. Falls back to the static screenshot when no preview exists.
const ScenePreviewTile: React.FC<{
  scene: GQL.SlimSceneDataFragment;
  onClick: () => void;
}> = ({ scene, onClick }) => {
  const preview = scene.paths?.preview || undefined;
  const screenshot = scene.paths?.screenshot || undefined;

  return (
    <div
      onClick={onClick}
      className="group/tile relative aspect-video w-full overflow-hidden rounded-lg cursor-pointer ring-1 ring-white/10 shadow-xl"
    >
      {preview ? (
        <video
          src={preview}
          poster={screenshot}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : (
        <img
          src={screenshot}
          alt={scene.title || ""}
          className="h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent opacity-70 transition-opacity duration-300 group-hover/tile:opacity-95" />
      <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover/tile:opacity-100">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur-md ring-1 ring-white/30">
          <Play size={18} fill="currentColor" className="ml-0.5 text-white" />
        </div>
      </div>
      {scene.title && (
        <span className="absolute bottom-1.5 left-2.5 right-2.5 truncate text-xs font-medium text-white/90 drop-shadow">
          {scene.title}
        </span>
      )}
    </div>
  );
};

// Small bullet separator for the metadata line.
const Dot: React.FC = () => (
  <span className="h-1 w-1 flex-shrink-0 rounded-full bg-white/40" />
);

export const GroupsHero: React.FC = () => {
  const history = useHistory();
  const [activeIndex, setActiveIndex] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);
  const [paused, setPaused] = useState(false);

  // Fetch random groups
  const { data, loading } = GQL.useFindGroupsQuery({
    variables: {
      filter: {
        per_page: 8,
        sort: "random",
      },
    },
  });

  const groups = (data?.findGroups?.groups || []).filter(
    (g) => g.front_image_path
  );
  const count = groups.length;
  const group = groups[activeIndex];

  // Crossfade to a specific group.
  const goTo = useCallback(
    (idx: number) => {
      if (count === 0) return;
      setFadeIn(false);
      setTimeout(() => {
        setActiveIndex(((idx % count) + count) % count);
        setFadeIn(true);
      }, FADE_MS);
    },
    [count]
  );

  // Fetch the active group's scenes (with previews) for the carousel.
  const { data: scenesData } = GQL.useFindScenesQuery({
    skip: !group,
    variables: {
      filter: { per_page: 12 },
      scene_filter: {
        groups: {
          value: group ? [group.id] : [],
          modifier: GQL.CriterionModifier.Includes,
        },
      },
    },
  });

  const scenes = scenesData?.findScenes?.scenes ?? [];
  // Split the scenes across two stacked carousels.
  const mid = Math.ceil(scenes.length / 2);
  const sceneRows = [scenes.slice(0, mid), scenes.slice(mid)].filter(
    (row) => row.length > 0
  );

  // Auto-advance through the random groups, paused while the user is hovering
  // so they can interact with the scene previews.
  useEffect(() => {
    if (count === 0 || paused) return;
    const t = setInterval(() => goTo(activeIndex + 1), ROTATE_MS);
    return () => clearInterval(t);
  }, [count, paused, activeIndex, goTo]);

  if (loading || count === 0 || !group) return null;

  const frontImage = group.front_image_path || "";
  const backImage = group.back_image_path;
  const { studio } = group;
  const year = group.date ? group.date.slice(0, 4) : undefined;
  const sceneCount = group.scene_count ?? 0;

  const handleGroupClick = () => history.push(`/groups/${group.id}`);

  return (
    <Box sx={{ display: { xs: "none", md: "block" } }}>
      <div
        className="fixed top-0 left-0 z-0 h-screen w-screen overflow-hidden bg-black"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Drifting, blurred backdrop */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url('${backImage || frontImage}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(28px) brightness(0.4) saturate(1.1)",
            transformOrigin: "center",
            animation: `${kenBurns} 22s ease-in-out infinite alternate`,
            transition: `opacity ${FADE_MS * 2}ms ease-in-out`,
            opacity: fadeIn ? 1 : 0,
          }}
        />

        {/* Depth: vignette + bottom + left gradients for legibility */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.55)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/10 to-transparent" />

        {/* Pacing segments (top-right) */}
        <div className="absolute right-10 top-7 z-20 flex gap-1.5">
          {groups.map((g, i) => (
            <button
              key={g.id}
              type="button"
              aria-label={`Show group ${i + 1}`}
              onClick={() => goTo(i)}
              className="h-1 w-9 overflow-hidden rounded-full bg-white/25 transition-colors hover:bg-white/40"
            >
              {i === activeIndex && (
                <Box
                  component="span"
                  key={activeIndex}
                  sx={{
                    display: "block",
                    height: "100%",
                    bgcolor: "#fff",
                    animation: `${grow} ${ROTATE_MS}ms linear forwards`,
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Content — centered, two-column composition */}
        <div
          className={cx(
            "absolute inset-0 flex items-center justify-center gap-12 px-10 py-20 lg:gap-16 lg:px-16 transition-all ease-out",
            fadeIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          )}
          style={{ transitionDuration: "900ms" }}
        >
          {/* Left column: poster art + title */}
          <div className="flex flex-shrink-0 flex-col items-start gap-8">
            {/* Poster art with color halo + fanned back cover */}
            <div className="relative flex-shrink-0">
              {/* Color halo bleeding from the artwork */}
              <div
                aria-hidden
                className="absolute -inset-8 -z-10 rounded-[2rem] bg-cover bg-center opacity-60 blur-3xl saturate-150"
                style={{ backgroundImage: `url('${frontImage}')` }}
              />
              <div className="relative w-[300px] lg:w-[380px]">
                {backImage && (
                  <div className="absolute -left-12 bottom-0 w-[78%] origin-bottom-right -rotate-6">
                    <div className="aspect-[2/3] overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10">
                      <img
                        src={backImage}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>
                )}
                <div
                  onClick={handleGroupClick}
                  className="group/poster relative aspect-[2/3] w-full cursor-pointer overflow-hidden rounded-lg shadow-[0_25px_60px_rgba(0,0,0,0.7)] ring-1 ring-white/15 transition-transform duration-500 hover:scale-[1.03]"
                >
                  <img
                    src={frontImage}
                    alt={group.name}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-300 group-hover/poster:opacity-100">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur-md ring-1 ring-white/40">
                      <Play size={24} fill="currentColor" className="ml-1 text-white" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Title block */}
            <div className="flex max-w-2xl flex-col items-start gap-3 pb-1">
              {/* Kicker */}
              <div className="flex items-center gap-2">
                {studio?.image_path && (
                  <img
                    src={studio.image_path}
                    alt={studio.name}
                    className="h-5 w-auto object-contain opacity-90"
                  />
                )}
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                  {studio?.name ?? "Featured Group"}
                </span>
              </div>

              {/* Title */}
              <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-white drop-shadow-2xl line-clamp-2 lg:text-5xl">
                {group.name}
              </h1>

              {/* Minimal meta line */}
              {(year || sceneCount > 0) && (
                <div className="flex items-center gap-3 text-sm font-medium text-white/60">
                  {year && <span>{year}</span>}
                  {year && sceneCount > 0 && <Dot />}
                  {sceneCount > 0 && (
                    <span>
                      {sceneCount} {sceneCount === 1 ? "scene" : "scenes"}
                    </span>
                  )}
                </div>
              )}

              {/* CTA */}
              <div className="mt-2">
                
              </div>
            </div>
          </div>

          {/* Right column: two ambient scene-preview rows, auto-advancing */}
          {sceneRows.length > 0 && (
            <div className="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4">
              {sceneRows.map((row, i) => (
                <Carousel
                  key={i}
                  itemWidth={360}
                  gap={16}
                  autoPlay
                  autoPlayInterval={i === 0 ? 4000 : 5200}
                  showArrows={false}
                >
                  {row.map((scene) => (
                    <ScenePreviewTile
                      key={scene.id}
                      scene={scene}
                      onClick={() => history.push(`/scenes/${scene.id}`)}
                    />
                  ))}
                </Carousel>
              ))}
            </div>
          )}
        </div>
      </div>
    </Box>
  );
};
