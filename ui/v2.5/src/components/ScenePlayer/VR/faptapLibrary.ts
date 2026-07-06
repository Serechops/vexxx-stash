/**
 * FapTapHomeLibrary — server-backed data source for the premium "FapTap" content
 * mode in the immersive Home wall. It is the FapTap analogue of
 * [VRHomeLibrary](./vrHomeLibrary.ts): same generation-guarded
 * setQuery/getPage/getCounts/getRail/getNextSceneId contract, so the existing
 * scene-grid wall renders FapTap rows with no changes to the grid itself.
 *
 * Unlike the Stash library it is not backed by Apollo/GraphQL — FapTap lives in a
 * read-only sidecar database exposed by the Go `/faptap/*` route group. The rows
 * are not Stash scenes, so when one is launched we synthesize a
 * `GQL.SceneDataFragment` ([buildFapSceneFragment]) carrying the CDN stream, the
 * funscript URL, and a projection derived from the FapTap `projection`/`vr`
 * fields — everything the player pipeline reads. The whole module is inert (and
 * the tab stays locked) unless the sidecar database is present.
 *
 * Filter-rail note: the scrape links videos to tags but not to creators, so the
 * rail's first slot carries FapTap tags (usable as a filter) and the second slot
 * carries creators for display only. The wall's generic studio/performer slots
 * are reused: a "studio"-slot tap is interpreted here as a tag filter.
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

/** Build an absolute /faptap URL honouring the app base path + dev port. */
function faptapURL(path: string, params?: Record<string, string>): string {
  const url = getPlatformURL("faptap/" + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== "") url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function getJSON<T>(path: string, params?: Record<string, string>): Promise<T> {
  const res = await fetch(faptapURL(path, params), { credentials: "include" });
  if (!res.ok) throw new Error(`faptap ${path} ${res.status}`);
  return (await res.json()) as T;
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
  vr: boolean;
  projection: string;
  has_funscript: boolean;
  tags: RawTag[];
}
interface RawListResult {
  videos: RawCard[];
  total: number;
}
interface RawDetail extends RawCard {
  description: string;
  creator: string;
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

/**
 * Rewrite faptap.net thumbnail/preview URLs through the backend proxy so the
 * browser never makes a cross-origin request (faptap.net has no CORS headers).
 * CDN URLs (BunnyCDN etc.) are returned unchanged — they already work.
 */
function proxyIfNeeded(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("https://faptap.net/")) {
    return faptapURL("thumb", { url });
  }
  return url;
}

/** Map a FapTap card row onto the grid entry the Home wall renders. */
function mapCard(c: RawCard): IVRSceneEntry {
  return {
    id: c.id,
    title: c.name || `FapTap ${c.id}`,
    thumbnailUrl: proxyIfNeeded(c.thumbnail_url),
    // The grid card uses the short preview clip on hover; full playback resolves
    // its CDN source lazily on launch via /faptap/videos/{id}/sources.
    streamUrl: null,
    studioName: null,
    performers: [],
    previewUrl: proxyIfNeeded(c.preview_url),
    vrMode: c.projection || null,
    hasFunscript: !!c.has_funscript,
    durationSecs: c.duration || null,
    tags: (c.tags ?? []).map((t) => t.name),
  };
}

/**
 * Map a FapTap projection string + vr flag onto the GQL.VrMode the player's
 * projectionForVrMode() understands. FapTap projection text varies; we key off
 * common tokens. Non-VR (vr === false) returns null → flat playback.
 */
export function fapProjectionToVrMode(
  projection: string | null | undefined,
  vr: boolean
): GQL.VrMode | null {
  if (!vr) return null;
  const p = (projection ?? "").toLowerCase();
  if (p.includes("fisheye") || p.includes("mkx") || p.includes("rf52")) {
    return GQL.VrMode.Fisheye190;
  }
  if (p.includes("360")) {
    if (p.includes("tb") || p.includes("top")) return GQL.VrMode.Tb360;
    return GQL.VrMode.Mono360;
  }
  // Default VR layout: 180° side-by-side.
  return GQL.VrMode.Lr180;
}

/**
 * Synthesize a GQL.SceneDataFragment from a FapTap detail + its resolved CDN
 * sources. Only the fields the immersive player reads are populated; the cast
 * mirrors the LOBBY_SCENE trick in ImmersiveVRPlayer.
 */
export function buildFapSceneFragment(
  detail: RawDetail,
  sources: RawSources
): GQL.SceneDataFragment {
  const allUrls = [sources.stream, ...(sources.fallbacks ?? [])].filter(Boolean);
  const streams = allUrls.map(
    (url) => ({ __typename: "SceneStreamEndpoint", url, label: null, mime_type: null } as never)
  );
  const funscriptUrl = detail.has_funscript
    ? faptapURL(`videos/${detail.id}/funscript`)
    : null;

  return {
    __typename: "Scene",
    id: `faptap:${detail.id}`,
    title: detail.name,
    details: detail.description ?? "",
    interactive: !!detail.has_funscript,
    vr_mode: fapProjectionToVrMode(detail.projection, detail.vr),
    paths: {
      __typename: "ScenePathsType",
      stream: sources.stream || null,
      screenshot: detail.thumbnail_url || null,
      preview: detail.preview_url || null,
      funscript: funscriptUrl,
    },
    sceneStreams: streams,
    performers: detail.creator
      ? [
          {
            __typename: "Performer",
            id: `faptap-creator:${detail.id}`,
            name: detail.creator,
            image_path: null,
          },
        ]
      : [],
    tags: (detail.tags ?? []).map((t) => ({
      __typename: "Tag",
      id: `faptap-tag:${t.id}`,
      name: t.name,
    })),
    scene_markers: [],
    captions: [],
  } as unknown as GQL.SceneDataFragment;
}

/** Map the home query's media/sort/filter onto the FapTap REST params. */
function queryParams(q: IVRHomeQuery): Record<string, string> {
  const media =
    q.mediaFilter === "vr"
      ? "vr"
      : q.mediaFilter === "flat"
      ? "flat"
      : q.mediaFilter === "funscript"
      ? "funscript"
      : "all";
  const sort =
    q.sort === "rating" ? "rating" : q.sort === "title" ? "title" : "recent";
  // The rail's first ("studio") slot holds FapTap tags; treat it as a tag
  // filter. Creator ("performer") taps aren't a usable filter, so ignore.
  let tag = "";
  if (q.filter && (q.filter.kind === "tag" || q.filter.kind === "studio")) {
    tag = q.filter.id;
  }
  // Free-text search → sidecar `q` param (name LIKE match server-side; the
  // empty string is dropped by getJSON's param builder).
  return { media, sort, tag, q: q.search?.trim() ?? "" };
}

// ── Favorites (localStorage-backed, no server round-trip) ────────────────────

const FAV_KEY = "vexxx:faptap:favorites";

/**
 * Thin localStorage wrapper for the user's FapTap favorite video IDs.
 * Persists across sessions; no server dependency.
 */
export class FaptapFavorites {
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

export const faptapFavorites = new FaptapFavorites();

// ── Status probe ──────────────────────────────────────────────────────────────

/** One-shot status probe used by the session manager to lock/unlock the tab. */
export async function fetchFaptapStatus(): Promise<{
  available: boolean;
  total: number;
}> {
  try {
    return await getJSON<{ available: boolean; total: number }>("status");
  } catch {
    return { available: false, total: 0 };
  }
}

export class FapTapHomeLibrary implements IVRHomeDataSource {
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
  // Cache of entries seen so far — used to serve the favorites page without
  // re-fetching IDs that were already loaded during normal browsing.
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
    const ids = faptapFavorites.list();
    const totalCount = ids.length;
    const pageIds = ids.slice(pageIndex * PER_PAGE, (pageIndex + 1) * PER_PAGE);

    // Fetch any IDs that weren't loaded during normal browsing.
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
    const tag =
      this.query.filter &&
      (this.query.filter.kind === "tag" || this.query.filter.kind === "studio")
        ? this.query.filter.id
        : "";
    try {
      return await getJSON<IVRHomeCounts>("counts", { tag });
    } catch {
      return { all: 0, vr: 0, flat: 0, funscript: 0 };
    }
  }

  async getRail(): Promise<IVRHomeRail> {
    const [tags, creators] = await Promise.all([
      getJSON<RawRailEntry[]>("tags").catch(() => []),
      getJSON<RawRailEntry[]>("creators").catch(() => []),
    ]);
    return {
      // Tags occupy the "studios" slot (usable as a filter).
      studios: tags.map((t) => ({
        id: t.id,
        name: t.name,
        imageUrl: null,
        count: t.count,
      })),
      // Creators occupy the "performers" slot (display only).
      performers: creators.map((c) => ({
        id: c.id,
        name: c.name,
        imageUrl: null,
        count: c.count,
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
