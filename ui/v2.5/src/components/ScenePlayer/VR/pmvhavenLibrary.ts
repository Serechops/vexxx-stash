/**
 * PmvHavenHomeLibrary — server-backed data source for the premium "PMVHaven"
 * content mode in the immersive Home wall. It is the PMVHaven analogue of
 * [FapTapHomeLibrary](./faptapLibrary.ts) / [VRHomeLibrary](./vrHomeLibrary.ts):
 * same generation-guarded setQuery/getPage/getCounts/getRail/getNextSceneId
 * contract, so the existing scene-grid wall renders PMVHaven rows unchanged.
 *
 * Like FapTap it is not backed by Apollo/GraphQL — PMVHaven lives in a read-only
 * sidecar database exposed by the Go `/pmvhaven/*` route group. The rows are not
 * Stash scenes, so a launched video is turned into a synthesized
 * `GQL.SceneDataFragment` ([buildPmvSceneFragment]) carrying the single CDN
 * stream and the on-demand funscript URL. The whole module is inert (and the tab
 * stays locked) unless the sidecar database is present.
 *
 * Differences from FapTap:
 *  - all content is flat (no VR projection) → `vrMode` is always null;
 *  - the PMVHaven CDN sends NO Access-Control-Allow-Origin, so thumbnails,
 *    previews and the video stream are all proxied same-origin through
 *    `/pmvhaven/thumb` and `/pmvhaven/media`. A direct cross-origin load is
 *    rejected by the browser for the crossorigin="anonymous" <img>/<video> the
 *    WebGL canvas wall and flat-scene texture require (without this the cards
 *    are blank and the video never plays);
 *  - performers are real and filterable: the rail's two slots are Tags (studio
 *    slot) and Stars (performer slot), both usable as filters;
 *  - PMVHaven has no funscripts; every video is funscript-capable because the
 *    backend generates one on demand from the audio, so `hasFunscript` is always
 *    true and the funscript URL is always wired.
 */
import * as GQL from "src/core/generated-graphql";
import { getPlatformURL } from "src/core/createClient";
import { IVRSceneEntry } from "./VRScenesPanel";
import {
  IVRHomeCounts,
  IVRHomeDataSource,
  IVRHomePageResult,
  IVRHomeQuery,
  IVRHomeRail,
  VR_SCENE_PAGE_SIZE,
} from "./types";

/** One Home-wall scene grid page — from the shared layout contract in types.ts. */
const PER_PAGE = VR_SCENE_PAGE_SIZE;

/** Build an absolute /pmvhaven URL honouring the app base path + dev port. */
function pmvURL(path: string, params?: Record<string, string>): string {
  const url = getPlatformURL("pmvhaven/" + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== "") url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function getJSON<T>(path: string, params?: Record<string, string>): Promise<T> {
  const res = await fetch(pmvURL(path, params), { credentials: "include" });
  if (!res.ok) throw new Error(`pmvhaven ${path} ${res.status}`);
  return (await res.json()) as T;
}

/** PMVHaven CDN host whose assets must be proxied (it sends no CORS headers). */
const PMV_CDN = "https://video.pmvhaven.com/";

/**
 * Rewrite a CDN image URL through the same-origin `/pmvhaven/thumb` proxy so a
 * crossorigin="anonymous" <img> (required to draw cards into the WebGL canvas)
 * is accepted. Non-CDN/relative URLs pass through unchanged.
 */
function proxyImg(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith(PMV_CDN) ? pmvURL("thumb", { url }) : url;
}

/**
 * Rewrite a CDN video URL (full stream or hover preview) through the same-origin
 * `/pmvhaven/media` range proxy so the crossorigin="anonymous" <video> the flat
 * texture path needs can load and seek it. Non-CDN/relative URLs pass through.
 */
function proxyMedia(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith(PMV_CDN) ? pmvURL("media", { url }) : url;
}

// ── Wire shapes returned by the Go handlers ──────────────────────────────────

interface RawTag {
  id: string;
  name: string;
}
interface RawCard {
  id: string;
  name: string;
  thumbnail_url: string;
  preview_url: string;
  duration: number;
  views: number;
  rating: number;
  width: number;
  height: number;
  has_funscript: boolean;
  tags: RawTag[];
}
interface RawListResult {
  videos: RawCard[];
  total: number;
}
interface RawDetail extends RawCard {
  description: string;
  uploader: string;
  stars: string[];
}
interface RawSources {
  stream: string;
  fallbacks: string[];
}
interface RawRailEntry {
  id: string;
  name: string;
  count: number;
}

/** Map a PMVHaven card row onto the grid entry the Home wall renders. */
function mapCard(c: RawCard): IVRSceneEntry {
  return {
    id: c.id,
    title: c.name || `PMVHaven ${c.id}`,
    thumbnailUrl: proxyImg(c.thumbnail_url),
    // Full playback resolves its CDN source lazily on launch via
    // /pmvhaven/videos/{id}/sources; the grid card hovers the preview clip.
    streamUrl: null,
    studioName: null,
    performers: [],
    previewUrl: proxyMedia(c.preview_url),
    // PMVHaven is all flat — no VR projection.
    vrMode: null,
    hasFunscript: true,
    durationSecs: c.duration || null,
    tags: (c.tags ?? []).map((t) => t.name),
  };
}

/**
 * Synthesize a GQL.SceneDataFragment from a PMVHaven detail + its resolved CDN
 * source. Only the fields the immersive player reads are populated; the cast
 * mirrors the LOBBY_SCENE trick in ImmersiveVRPlayer. The funscript is always
 * wired (the backend generates it on demand), and projection is always flat.
 */
export function buildPmvSceneFragment(
  detail: RawDetail,
  sources: RawSources
): GQL.SceneDataFragment {
  // Every CDN source goes through the same-origin media proxy so the
  // crossorigin="anonymous" <video> can load and texture-upload it.
  const allUrls = [sources.stream, ...(sources.fallbacks ?? [])]
    .filter(Boolean)
    .map((u) => proxyMedia(u) as string);
  const streams = allUrls.map(
    (url) => ({ __typename: "SceneStreamEndpoint", url, label: null, mime_type: null } as never)
  );
  const funscriptUrl = pmvURL(`videos/${detail.id}/funscript`);

  return {
    __typename: "Scene",
    id: `pmvhaven:${detail.id}`,
    title: detail.name,
    details: detail.description ?? "",
    interactive: true,
    vr_mode: null,
    paths: {
      __typename: "ScenePathsType",
      stream: allUrls[0] || null,
      screenshot: proxyImg(detail.thumbnail_url),
      preview: proxyMedia(detail.preview_url),
      funscript: funscriptUrl,
    },
    sceneStreams: streams,
    studio: detail.uploader
      ? {
          __typename: "Studio",
          id: `pmvhaven-studio:${detail.id}`,
          name: detail.uploader,
          image_path: null,
        }
      : null,
    performers: (detail.stars ?? []).map((name, i) => ({
      __typename: "Performer",
      id: `pmvhaven-star:${detail.id}:${i}`,
      name,
      image_path: null,
    })),
    tags: (detail.tags ?? []).map((t) => ({
      __typename: "Tag",
      id: `pmvhaven-tag:${t.id}`,
      name: t.name,
    })),
    scene_markers: [],
    captions: [],
  } as unknown as GQL.SceneDataFragment;
}

/** Map the home query's sort/filter onto the PMVHaven REST params. */
function queryParams(q: IVRHomeQuery): Record<string, string> {
  const sort =
    q.sort === "rating" ? "rating" : q.sort === "title" ? "title" : "recent";
  // Rail slot mapping: the "studio" slot holds Tags, the "performer" slot holds
  // Stars. Both are real filters here.
  let tag = "";
  let star = "";
  if (q.filter) {
    if (q.filter.kind === "tag" || q.filter.kind === "studio") {
      tag = q.filter.id;
    } else if (q.filter.kind === "performer") {
      star = q.filter.id;
    }
  }
  // Free-text search → sidecar `q` param (title LIKE match server-side; the
  // empty string is dropped by getJSON's param builder).
  return { sort, tag, star, media: "all", q: q.search?.trim() ?? "" };
}

// ── Favorites (localStorage-backed, no server round-trip) ────────────────────

const FAV_KEY = "vexxx:pmvhaven:favorites";

/**
 * Thin localStorage wrapper for the user's PMVHaven favorite video IDs.
 * Persists across sessions; no server dependency.
 */
export class PmvHavenFavorites {
  private ids: Set<string>;

  constructor() {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      this.ids = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      this.ids = new Set();
    }
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  toggle(id: string): boolean {
    if (this.ids.has(id)) {
      this.ids.delete(id);
    } else {
      this.ids.add(id);
    }
    this._save();
    return this.ids.has(id);
  }

  list(): string[] {
    return [...this.ids];
  }

  private _save() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...this.ids]));
    } catch {}
  }
}

export const pmvhavenFavorites = new PmvHavenFavorites();

// ── Status probe ──────────────────────────────────────────────────────────────

/** One-shot status probe used by the session manager to lock/unlock the tab. */
export async function fetchPmvhavenStatus(): Promise<{
  available: boolean;
  total: number;
}> {
  try {
    return await getJSON<{ available: boolean; total: number }>("status");
  } catch {
    return { available: false, total: 0 };
  }
}

export class PmvHavenHomeLibrary implements IVRHomeDataSource {
  private query: IVRHomeQuery = {
    sort: "recent",
    mediaFilter: "all",
    filter: null,
    search: null,
  };
  private generation = 0;
  // Virtual index of every row we've paged, for auto-advance.
  private indexById = new Map<string, number>();
  private totalForQuery = -1;
  // Cache of entries seen so far — serves the favorites page without re-fetching.
  private entryCache = new Map<string, IVRSceneEntry>();

  get gen(): number {
    return this.generation;
  }

  setQuery(q: IVRHomeQuery): number {
    this.query = q;
    this.generation++;
    this.indexById.clear();
    this.totalForQuery = -1;
    return this.generation;
  }

  async getPage(pageIndex: number): Promise<IVRHomePageResult> {
    if (this.query.mediaFilter === "favorites") {
      return this.getFavoritesPage(pageIndex);
    }
    const gen = this.generation;
    const params = {
      ...queryParams(this.query),
      page: String(pageIndex + 1),
      per_page: String(PER_PAGE),
    };
    let res: RawListResult;
    try {
      res = await getJSON<RawListResult>("videos", params);
    } catch {
      res = { videos: [], total: 0 };
    }
    const scenes = res.videos.map(mapCard);
    this.totalForQuery = res.total;
    for (let i = 0; i < scenes.length; i++) {
      this.indexById.set(scenes[i].id, pageIndex * PER_PAGE + i);
      this.entryCache.set(scenes[i].id, scenes[i]);
    }
    return { gen, pageIndex, scenes, totalCount: res.total };
  }

  // Favorites are stored locally (localStorage); serve them by reading entry
  // data from the in-memory cache first and fetching any missing IDs individually.
  private async getFavoritesPage(pageIndex: number): Promise<IVRHomePageResult> {
    const gen = this.generation;
    const ids = pmvhavenFavorites.list();
    const totalCount = ids.length;
    const pageIds = ids.slice(pageIndex * PER_PAGE, (pageIndex + 1) * PER_PAGE);

    await Promise.all(
      pageIds
        .filter((id) => !this.entryCache.has(id))
        .map(async (id) => {
          try {
            const detail = await getJSON<RawDetail>(`videos/${id}`);
            this.entryCache.set(id, mapCard(detail));
          } catch {}
        })
    );

    const scenes = pageIds
      .map((id) => this.entryCache.get(id))
      .filter((s): s is IVRSceneEntry => s != null);

    for (let i = 0; i < scenes.length; i++) {
      this.indexById.set(scenes[i].id, pageIndex * PER_PAGE + i);
    }
    return { gen, pageIndex, scenes, totalCount };
  }

  async getCounts(): Promise<IVRHomeCounts> {
    let tag = "";
    let star = "";
    if (this.query.filter) {
      if (this.query.filter.kind === "tag" || this.query.filter.kind === "studio") {
        tag = this.query.filter.id;
      } else if (this.query.filter.kind === "performer") {
        star = this.query.filter.id;
      }
    }
    try {
      return await getJSON<IVRHomeCounts>("counts", { tag, star });
    } catch {
      return { all: 0, vr: 0, flat: 0, funscript: 0 };
    }
  }

  async getRail(): Promise<IVRHomeRail> {
    const [tags, stars] = await Promise.all([
      getJSON<RawRailEntry[]>("tags").catch(() => []),
      getJSON<RawRailEntry[]>("stars").catch(() => []),
    ]);
    return {
      // Tags occupy the "studios" slot (filterable).
      studios: tags.map((t) => ({
        id: t.id,
        name: t.name,
        imageUrl: null,
        count: t.count,
      })),
      // Stars occupy the "performers" slot (filterable).
      performers: stars.map((s) => ({
        id: s.id,
        name: s.name,
        imageUrl: null,
        count: s.count,
      })),
    };
  }

  async getNextSceneId(currentId: string): Promise<string | null> {
    const idx = this.indexById.get(currentId);
    if (idx === undefined) return null;
    if (this.totalForQuery >= 0 && idx + 1 >= this.totalForQuery) return null;
    const nextIdx = idx + 1;
    const page = await this.getPage(Math.floor(nextIdx / PER_PAGE));
    if (page.gen !== this.generation) return null;
    return page.scenes[nextIdx % PER_PAGE]?.id ?? null;
  }
}
