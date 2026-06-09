import React from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@mui/material";
import { useStats } from "src/core/StashService";
import * as GQL from "src/core/generated-graphql";
import { FormattedMessage, FormattedNumber, useIntl } from "react-intl";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import TextUtils from "src/utils/text";
import { FileSize } from "./Shared/FileSize";
import { useConfigurationContext } from "src/hooks/Config";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { PerformerCard } from "./Performers/PerformerCard";
import { SceneCard } from "./Scenes/SceneCard";
import { SceneQueue } from "src/models/sceneQueue";
import { Carousel } from "./Shared/Carousel";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const CHART_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#ef4444",
  "#a855f7", "#06b6d4", "#f97316", "#84cc16", "#ec4899",
];
const AXIS_COLOR = "#71717a";
const GRID_COLOR = "#3f3f46";

function fmtGB(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

// ---------------------------------------------------------------------------
// Section divider  — "LABEL ──────────────────"
// ---------------------------------------------------------------------------
const SectionDivider: React.FC<{ label: string }> = ({ label }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
    <Typography sx={{
      fontSize: "0.65rem", color: "#52525b", textTransform: "uppercase",
      letterSpacing: "0.12em", whiteSpace: "nowrap",
    }}>
      {label}
    </Typography>
    <Box sx={{ flex: 1, height: "1px", background: "#3f3f46" }} />
  </Box>
);

// ---------------------------------------------------------------------------
// KPI stat card
// ---------------------------------------------------------------------------
const StatCard: React.FC<{ value: React.ReactNode; label: React.ReactNode }> = ({ value, label }) => (
  <Box sx={{
    flex: "0 0 auto",
    minWidth: 118,
    px: 2.5,
    py: 1.75,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid #3f3f46",
    borderRadius: 2,
    display: "flex",
    flexDirection: "column",
    gap: 0.5,
    transition: "border-color 0.15s",
    "&:hover": { borderColor: "#52525b" },
  }}>
    <Typography sx={{ fontSize: "1.5rem", fontWeight: 700, color: "#e4e4e7", lineHeight: 1.2 }}>
      {value}
    </Typography>
    <Typography sx={{ fontSize: "0.65rem", color: "#71717a", textTransform: "uppercase", letterSpacing: "0.08em" }}>
      {label}
    </Typography>
  </Box>
);

// ---------------------------------------------------------------------------
// KPI section (two groups: Scenes / Library)
// ---------------------------------------------------------------------------
const KpiSection: React.FC<{ sfwContentMode: boolean }> = ({ sfwContentMode }) => {
  const { data, error, loading } = useStats();
  if (error) return <span>{error.message}</span>;
  if (loading || !data) return <LoadingIndicator />;

  const oCountID = sfwContentMode ? "stats.total_o_count_sfw" : "stats.total_o_count";
  const scenesDuration    = TextUtils.secondsAsTimeString(data.stats.scenes_duration, 3);
  const totalPlayDuration = TextUtils.secondsAsTimeString(data.stats.total_play_duration, 3);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* ── Library ── */}
      <Box>
        <SectionDivider label="Library" />
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          <StatCard value={<FormattedNumber value={data.stats.scene_count} />}     label={<FormattedMessage id="scenes" />} />
          <StatCard value={<FormattedNumber value={data.stats.performer_count} />} label={<FormattedMessage id="performers" />} />
          <StatCard value={<FormattedNumber value={data.stats.studio_count} />}    label={<FormattedMessage id="studios" />} />
          <StatCard value={<FormattedNumber value={data.stats.group_count} />}     label={<FormattedMessage id="groups" />} />
          <StatCard value={<FormattedNumber value={data.stats.tag_count} />}       label={<FormattedMessage id="tags" />} />
          <StatCard value={<FormattedNumber value={data.stats.gallery_count} />}   label={<FormattedMessage id="galleries" />} />
          <StatCard value={<FormattedNumber value={data.stats.image_count} />}     label={<FormattedMessage id="images" />} />
        </Box>
      </Box>

      {/* ── Storage ── */}
      <Box>
        <SectionDivider label="Storage" />
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          <StatCard value={<FileSize size={data.stats.scenes_size} />}             label={<FormattedMessage id="stats.scenes_size" />} />
          <StatCard value={scenesDuration || "—"}                                  label={<FormattedMessage id="stats.scenes_duration" />} />
          <StatCard value={<FileSize size={data.stats.images_size} />}             label={<FormattedMessage id="stats.image_size" />} />
        </Box>
      </Box>

      {/* ── Activity ── */}
      <Box>
        <SectionDivider label="Activity" />
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          <StatCard value={<FormattedNumber value={data.stats.scenes_played} />}   label={<FormattedMessage id="stats.scenes_played" />} />
          <StatCard value={<FormattedNumber value={data.stats.total_play_count} />} label={<FormattedMessage id="stats.total_play_count" />} />
          <StatCard value={totalPlayDuration || "—"}                               label={<FormattedMessage id="stats.total_play_duration" />} />
          <StatCard value={<FormattedNumber value={data.stats.total_o_count} />}   label={<FormattedMessage id={oCountID} />} />
        </Box>
      </Box>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Custom tooltips — avoids recharts v3 Formatter type constraints
// ---------------------------------------------------------------------------
interface TooltipEntry { value?: number; payload?: { size?: number } }

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8,
  fontSize: 12, padding: "8px 12px",
};

function SceneCountTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE}>
      {label && <div style={{ color: "#e4e4e7", marginBottom: 4 }}>{label}</div>}
      <div style={{ color: "#a1a1aa" }}>{payload[0]?.value ?? 0} scenes</div>
    </div>
  );
}

function SceneSizeTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const val  = payload[0]?.value ?? 0;
  const size = payload[0]?.payload?.size ?? 0;
  return (
    <div style={TOOLTIP_STYLE}>
      {label && <div style={{ color: "#e4e4e7", marginBottom: 4 }}>{label}</div>}
      <div style={{ color: "#a1a1aa" }}>{val} scenes{size > 0 ? ` • ${fmtGB(size)}` : ""}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart card
// ---------------------------------------------------------------------------
const ChartCard: React.FC<{ title: string; children: React.ReactNode; fullWidth?: boolean }> = ({
  title, children, fullWidth,
}) => (
  <Box sx={{
    flex: fullWidth ? "0 0 100%" : { xs: "0 0 100%", md: "0 0 calc(50% - 8px)" },
    background: "rgba(255,255,255,0.03)",
    border: "1px solid #3f3f46",
    borderRadius: 2,
    p: 2,
  }}>
    <Typography variant="subtitle2" sx={{
      mb: 1.5, color: "#a1a1aa", textTransform: "uppercase",
      letterSpacing: "0.07em", fontSize: "0.7rem",
    }}>
      {title}
    </Typography>
    {children}
  </Box>
);

// ---------------------------------------------------------------------------
// Charts section
// ---------------------------------------------------------------------------
const ChartsSection: React.FC = () => {
  const intl = useIntl();
  const { data, loading, error } = GQL.useAnalyticsDataQuery();

  if (error) return <span>{error.message}</span>;
  if (loading || !data) return <LoadingIndicator />;

  const { analyticsData: a } = data;

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>

      {/* Library Growth */}
      <ChartCard title={intl.formatMessage({ id: "stats.library_growth", defaultMessage: "Library Growth" })} fullWidth>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={a.scenes_by_month} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} />
            <RechartsTooltip content={<SceneCountTooltip />} />
            <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2}
              fill="url(#growthGrad)" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* By Codec */}
      <ChartCard title={intl.formatMessage({ id: "stats.by_codec", defaultMessage: "By Video Codec" })}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={a.scenes_by_codec} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
            <XAxis type="number" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} width={64} />
            <RechartsTooltip content={<SceneSizeTooltip />} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]}>
              {a.scenes_by_codec.map((_e, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* By Resolution */}
      <ChartCard title={intl.formatMessage({ id: "stats.by_resolution", defaultMessage: "By Resolution" })}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={a.scenes_by_resolution} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
            <XAxis type="number" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} width={52} />
            <RechartsTooltip content={<SceneSizeTooltip />} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]}>
              {a.scenes_by_resolution.map((_e, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Rating Distribution */}
      <ChartCard title={intl.formatMessage({ id: "stats.rating_distribution", defaultMessage: "Rating Distribution" })}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={a.scenes_by_rating} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 12 }} tickLine={false} />
            <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} />
            <RechartsTooltip content={<SceneCountTooltip />} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {a.scenes_by_rating.map((_e, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Top Studios */}
      {a.scenes_by_studio.length > 0 && (
        <ChartCard title={intl.formatMessage({ id: "stats.top_studios", defaultMessage: "Top Studios by Scene Count" })} fullWidth>
          <ResponsiveContainer width="100%" height={Math.max(180, a.scenes_by_studio.length * 26)}>
            <BarChart data={a.scenes_by_studio} layout="vertical" margin={{ top: 0, right: 40, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} width={120} />
              <RechartsTooltip content={<SceneSizeTooltip />} />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 3, 3, 0]}
                label={{ position: "right", fill: AXIS_COLOR, fontSize: 11, formatter: (v: unknown) => String(v) }} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

    </Box>
  );
};

// ---------------------------------------------------------------------------
// Utility — format seconds as "Xh Ym"
// ---------------------------------------------------------------------------
function fmtHours(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Custom tooltip for watch-time bar charts
// ---------------------------------------------------------------------------
function WatchTimeTooltip({ active, payload, label }: { active?: boolean; payload?: { value?: number; payload?: { size?: number; count?: number } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const size = payload[0]?.payload?.size ?? 0;
  const count = payload[0]?.payload?.count ?? 0;
  return (
    <div style={TOOLTIP_STYLE}>
      {label && <div style={{ color: "#e4e4e7", marginBottom: 4 }}>{label}</div>}
      <div style={{ color: "#a1a1aa" }}>{fmtHours(size)} watched • {count} scenes</div>
    </div>
  );
}

function WatchActivityTooltip({ active, payload, label }: { active?: boolean; payload?: { value?: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE}>
      {label && <div style={{ color: "#e4e4e7", marginBottom: 4 }}>{label}</div>}
      <div style={{ color: "#a1a1aa" }}>{payload[0]?.value ?? 0} plays</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Most-played scenes carousel
// ---------------------------------------------------------------------------
const MostPlayedScenes: React.FC = () => {
  const { data, loading } = GQL.useFindScenesQuery({
    variables: {
      filter: {
        per_page: 24,
        sort: "play_count",
        direction: GQL.SortDirectionEnum.Desc,
      },
      scene_filter: {
        play_count: { value: 0, modifier: GQL.CriterionModifier.GreaterThan },
      },
    },
  });

  const scenes = React.useMemo(
    () => data?.findScenes.scenes ?? [],
    [data]
  );
  const queue = React.useMemo(
    () => SceneQueue.fromSceneIDList(scenes.map((s) => s.id)),
    [scenes]
  );

  if (!loading && scenes.length === 0) return null;

  return (
    <Carousel itemWidth={320} gap={12} autoPlay={false}>
      {loading
        ? [...Array(8)].map((_, i) => (
            <Skeleton key={i} variant="rectangular"
              sx={{ width: 320, height: 240, borderRadius: 1.5, bgcolor: "grey.800", flexShrink: 0 }} />
          ))
        : scenes.map((scene, index) => (
            <Box key={scene.id} sx={{ width: 320, flexShrink: 0 }}>
              <SceneCard scene={scene} queue={queue} index={index} zoomIndex={1} />
            </Box>
          ))}
    </Carousel>
  );
};

// ---------------------------------------------------------------------------
// Highlights section  (most-played + watch-time rankings + activity)
// ---------------------------------------------------------------------------
const HighlightsSection: React.FC = () => {
  const intl = useIntl();
  const { data, loading, error } = GQL.useAnalyticsDataQuery();

  if (error) return <span>{error.message}</span>;
  if (loading || !data) return <LoadingIndicator />;

  const { analyticsData: a } = data;
  const hasStudioWatch = a.top_studios_by_watch_time.length > 0;
  const hasPerformerWatch = a.top_performers_by_watch_time.length > 0;
  const hasActivity = a.monthly_watch_activity.length > 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>

      {/* Watch Activity timeline — sets context for everything below */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
      {hasActivity && (
        <ChartCard
          title={intl.formatMessage({ id: "stats.watch_activity", defaultMessage: "Watch Activity" })}
          fullWidth
        >
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={a.monthly_watch_activity} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="activityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} axisLine={false} />
              <RechartsTooltip content={<WatchActivityTooltip />} />
              <Area type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={2}
                fill="url(#activityGrad)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Top studios by watch time */}
      {hasStudioWatch && (
        <ChartCard
          title={intl.formatMessage({ id: "stats.top_studios_watch", defaultMessage: "Top Studios by Watch Time" })}
          fullWidth={!hasPerformerWatch}
        >
          <ResponsiveContainer width="100%" height={Math.max(180, a.top_studios_by_watch_time.length * 26)}>
            <BarChart data={a.top_studios_by_watch_time} layout="vertical" margin={{ top: 0, right: 60, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => fmtHours(v)} />
              <YAxis type="category" dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} width={110} />
              <RechartsTooltip content={<WatchTimeTooltip />} />
              <Bar dataKey="size" radius={[0, 3, 3, 0]}
                label={{ position: "right", fill: AXIS_COLOR, fontSize: 10, formatter: (v: unknown) => fmtHours(Number(v)) }}>
                {a.top_studios_by_watch_time.map((_e, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Top performers by watch time */}
      {hasPerformerWatch && (
        <ChartCard
          title={intl.formatMessage({ id: "stats.top_performers_watch", defaultMessage: "Top Performers by Watch Time" })}
          fullWidth={!hasStudioWatch}
        >
          <ResponsiveContainer width="100%" height={Math.max(180, a.top_performers_by_watch_time.length * 26)}>
            <BarChart data={a.top_performers_by_watch_time} layout="vertical" margin={{ top: 0, right: 60, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => fmtHours(v)} />
              <YAxis type="category" dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} tickLine={false} width={110} />
              <RechartsTooltip content={<WatchTimeTooltip />} />
              <Bar dataKey="size" radius={[0, 3, 3, 0]}
                label={{ position: "right", fill: AXIS_COLOR, fontSize: 10, formatter: (v: unknown) => fmtHours(Number(v)) }}>
                {a.top_performers_by_watch_time.map((_e, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      </Box>

      {/* Most-played scenes carousel */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", mb: 1.5 }}>
          <Typography sx={{ fontSize: "0.7rem", color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
            Most Played Scenes
          </Typography>
          <Typography
            component={Link}
            to="/scenes?sort=play_count&sortdir=desc"
            sx={{ fontSize: "0.7rem", color: "#6366f1", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
          >
            View all
          </Typography>
        </Box>
        <MostPlayedScenes />
      </Box>

    </Box>
  );
};

// ---------------------------------------------------------------------------
// Performer carousel row — renders a labelled horizontal scrollable row of
// PerformerCards, driven by a single useFindPerformersQuery call.
// ---------------------------------------------------------------------------
interface IPerformerRowProps {
  label: string;
  sort: string;
  performerFilter?: GQL.PerformerFilterType;
  /** Appended to the performers list URL as query params */
  linkParams?: string;
}

const PerformerCarouselRow: React.FC<IPerformerRowProps> = ({
  label, sort, performerFilter, linkParams = "",
}) => {
  const { data, loading } = GQL.useFindPerformersQuery({
    variables: {
      filter: { per_page: 12, sort, direction: GQL.SortDirectionEnum.Desc },
      performer_filter: performerFilter,
    },
  });

  const performers = data?.findPerformers.performers ?? [];
  if (!loading && performers.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", mb: 1.5 }}>
        <Typography sx={{
          fontSize: "0.7rem", color: "#a1a1aa", textTransform: "uppercase",
          letterSpacing: "0.07em", fontWeight: 600,
        }}>
          {label}
        </Typography>
        <Typography
          component={Link}
          to={`/performers?sort=${sort}&sortdir=desc${linkParams}`}
          sx={{ fontSize: "0.7rem", color: "#6366f1", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
        >
          View all
        </Typography>
      </Box>

      <Carousel itemWidth={180} gap={12} showArrows autoPlay={false}>
        {loading
          ? [...Array(8)].map((_, i) => (
              <Skeleton key={i} variant="rectangular"
                sx={{ width: 180, height: 270, borderRadius: 1.5, bgcolor: "grey.800", flexShrink: 0 }} />
            ))
          : performers.map((p) => (
              <Box key={p.id} sx={{ width: 180, flexShrink: 0 }}>
                <PerformerCard performer={p} cardWidth={180} />
              </Box>
            ))}
      </Carousel>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Performer highlights — three rows: most watched, most prolific, top rated
// ---------------------------------------------------------------------------
const PerformerHighlightsSection: React.FC = () => (
  <Box>
    <PerformerCarouselRow
      label="Most Watched"
      sort="play_count"
      performerFilter={{
        play_count: { value: 0, modifier: GQL.CriterionModifier.GreaterThan },
      }}
    />
    <PerformerCarouselRow
      label="Most Prolific"
      sort="scene_count"
      performerFilter={{
        scene_count: { value: 0, modifier: GQL.CriterionModifier.GreaterThan },
      }}
      linkParams="&scene_count=1"
    />
    <PerformerCarouselRow
      label="Top Rated"
      sort="rating"
      performerFilter={{
        rating100: { value: 0, modifier: GQL.CriterionModifier.GreaterThan },
      }}
    />
  </Box>
);

// ---------------------------------------------------------------------------
// Root – single unified dashboard
// ---------------------------------------------------------------------------
export const Stats: React.FC = () => {
  const { configuration } = useConfigurationContext();
  const { sfwContentMode } = configuration.interface;

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
      <KpiSection sfwContentMode={sfwContentMode} />
      <Box sx={{ mt: 4 }}>
        <SectionDivider label="Watch History" />
        <HighlightsSection />
      </Box>
      <Box sx={{ mt: 4 }}>
        <SectionDivider label="Performers" />
        <PerformerHighlightsSection />
      </Box>
      <Box sx={{ mt: 4 }}>
        <SectionDivider label="Library" />
        <ChartsSection />
      </Box>
    </Box>
  );
};

export default Stats;
