/**
 * VRHomeLibrary — server-backed data source for the immersive Home wall.
 *
 * The Home wall must scale to libraries of any size (tens of thousands of
 * scenes), so it cannot load the whole library into memory the way it used to.
 * This class pages + filters + sorts entirely on the server via `findScenes`,
 * sources the filter rail from `findStudios`/`findPerformers` (so it's accurate
 * regardless of which scenes are currently on screen), and derives the
 * media-type counts from lightweight `per_page: 0` count queries.
 *
 * "Continue watching": when sorted by Recent, in-progress scenes (resume_time >
 * threshold) are floated to the very top — preserving the old behaviour. They
 * form a virtual prefix ahead of the date-ordered stream and are removed from
 * that stream via `exclude_ids`, so a scene never appears twice. Grid pages that
 * straddle the prefix/stream boundary are composed from the cached prefix plus
 * the relevant date-ordered block(s) (≤2 network blocks per page).
 *
 * Everything is generation-guarded: [setQuery] bumps a counter and clears the
 * caches, and each page result carries the generation it was fetched under so
 * the manager can drop stale responses that land after a filter change.
 */
import * as GQL from "src/core/generated-graphql";
import { getClient } from "src/core/StashService";
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
/** Seconds of resume_time past which a scene counts as "in progress". */
const CONTINUE_THRESHOLD = 30;
/** Cap the continue-watching prefix to a single grid page so it only shifts page 0/1. */
const CONTINUE_MAX = PER_PAGE;
/** How many studios/performers to offer in the rail (sorted by scene count). */
const RAIL_MAX = 200;

const DESC = GQL.SortDirectionEnum.Desc;
const ASC = GQL.SortDirectionEnum.Asc;

type SlimScene = GQL.FindScenesQuery["findScenes"]["scenes"][number];

/** Map a slim scene fragment onto the card entry the Home wall renders. */
export function mapScene(s: SlimScene): IVRSceneEntry {
  return {
    id: s.id,
    title: s.title ?? `Scene ${s.id}`,
    thumbnailUrl: s.paths.screenshot ?? null,
    streamUrl: s.paths.stream ?? null,
    studioName: s.studio?.name ?? null,
    performers: s.performers.map((p) => p.name),
    previewUrl: s.paths.preview ?? null,
    vrMode: s.vr_mode ?? null,
    studioId: s.studio?.id ?? null,
    studioLogoUrl: s.studio?.image_path ?? null,
    performerDetails: s.performers.map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.image_path ?? null,
    })),
    hasFunscript: s.interactive && !!s.paths.funscript,
    heatmapUrl: s.paths.interactive_heatmap ?? null,
    resumeTime: s.resume_time ?? null,
    rating: s.rating100 ?? null,
    durationSecs: s.files[0]?.duration ?? null,
    dateAdded: s.date ?? null,
    width: s.files[0]?.width ?? null,
    height: s.files[0]?.height ?? null,
    tags: s.tags.map((t) => t.name),
  };
}

/** Build the SceneFilterType for the media toggle + studio/performer filter. */
function buildSceneFilter(q: IVRHomeQuery): GQL.SceneFilterType {
  const f: GQL.SceneFilterType = {};
  if (q.mediaFilter === "vr") {
    f.vr_mode = { modifier: GQL.CriterionModifier.NotNull };
  } else if (q.mediaFilter === "flat") {
    f.vr_mode = { modifier: GQL.CriterionModifier.IsNull };
  } else if (q.mediaFilter === "funscript") {
    f.interactive = true;
  }
  if (q.filter?.kind === "studio") {
    f.studios = {
      value: [q.filter.id],
      modifier: GQL.CriterionModifier.Includes,
      depth: 0,
    };
  } else if (q.filter?.kind === "performer") {
    f.performers = {
      value: [q.filter.id],
      modifier: GQL.CriterionModifier.Includes,
    };
  } else if (q.filter?.kind === "tag") {
    f.tags = {
      value: [q.filter.id],
      modifier: GQL.CriterionModifier.Includes,
      depth: 0,
    };
  }
  return f;
}

/** Map the sort mode onto a server sort key + direction. */
function serverSort(q: IVRHomeQuery): {
  sort: string;
  direction: GQL.SortDirectionEnum;
} {
  if (q.sort === "rating") return { sort: "rating", direction: DESC };
  if (q.sort === "title") return { sort: "title", direction: ASC };
  return { sort: "date", direction: DESC };
}

export class VRHomeLibrary implements IVRHomeDataSource {
  private query: IVRHomeQuery = {
    sort: "recent",
    mediaFilter: "all",
    filter: null,
    search: null,
  };
  private generation = 0;

  // Date-ordered stream, cached one PER_PAGE block at a time.
  private blockCache = new Map<number, IVRSceneEntry[]>();
  private blockPromises = new Map<number, Promise<IVRSceneEntry[]>>();
  // Continue-watching prefix (Recent only).
  private continueList: IVRSceneEntry[] | null = null;
  private continuePromise: Promise<IVRSceneEntry[]> | null = null;
  // Authoritative total for the current query (no exclude_ids) — drives paging.
  private totalForQuery = -1;
  private totalPromise: Promise<number> | null = null;
  // Virtual index of every scene we've paged, for auto-advance.
  private indexById = new Map<string, number>();

  get gen(): number {
    return this.generation;
  }

  setQuery(q: IVRHomeQuery): number {
    this.query = q;
    this.generation++;
    this.blockCache.clear();
    this.blockPromises.clear();
    this.continueList = null;
    this.continuePromise = null;
    this.totalForQuery = -1;
    this.totalPromise = null;
    this.indexById.clear();
    return this.generation;
  }

  /** Free-text search term for the find filter's `q`, or undefined when off. */
  private get searchQ(): string | undefined {
    const s = this.query.search?.trim();
    return s ? s : undefined;
  }

  /**
   * Recent sort floats in-progress scenes to the top via a virtual prefix —
   * suppressed while searching, so results read as one plain ranked list.
   */
  private get hasPrefix(): boolean {
    return this.query.sort === "recent" && !this.searchQ;
  }

  private loadContinue(): Promise<IVRSceneEntry[]> {
    if (!this.hasPrefix) return Promise.resolve([]);
    if (this.continueList) return Promise.resolve(this.continueList);
    if (!this.continuePromise) {
      const sceneFilter: GQL.SceneFilterType = {
        ...buildSceneFilter(this.query),
        resume_time: {
          value: CONTINUE_THRESHOLD,
          modifier: GQL.CriterionModifier.GreaterThan,
        },
      };
      this.continuePromise = getClient()
        .query<GQL.FindScenesQuery>({
          query: GQL.FindScenesDocument,
          variables: {
            filter: {
              per_page: CONTINUE_MAX,
              page: 1,
              sort: "last_played_at",
              direction: DESC,
            },
            scene_filter: sceneFilter,
          },
          fetchPolicy: "no-cache",
        })
        .then((r) => {
          this.continueList = r.data.findScenes.scenes.map(mapScene);
          return this.continueList;
        })
        .catch(() => {
          this.continueList = [];
          return this.continueList;
        });
    }
    return this.continuePromise;
  }

  private loadTotal(): Promise<number> {
    if (this.totalForQuery >= 0) return Promise.resolve(this.totalForQuery);
    if (!this.totalPromise) {
      this.totalPromise = getClient()
        .query<GQL.FindScenesQuery>({
          query: GQL.FindScenesDocument,
          variables: {
            filter: { per_page: 0, page: 1, q: this.searchQ },
            scene_filter: buildSceneFilter(this.query),
          },
          fetchPolicy: "no-cache",
        })
        .then((r) => {
          this.totalForQuery = r.data.findScenes.count;
          return this.totalForQuery;
        })
        .catch((e) => {
          // Don't cache a failed count as "0 scenes" (the wall would render as
          // an empty library) — clear the promise so a retry refetches, and
          // let the error reach the manager's page-error path.
          this.totalPromise = null;
          throw e;
        });
    }
    return this.totalPromise;
  }

  /** Fetch one PER_PAGE block of the date-ordered stream (excluding prefix ids). */
  private fetchBlock(
    blockIndex: number,
    excludeIds: string[]
  ): Promise<IVRSceneEntry[]> {
    const cached = this.blockCache.get(blockIndex);
    if (cached) return Promise.resolve(cached);
    let p = this.blockPromises.get(blockIndex);
    if (!p) {
      const { sort, direction } = serverSort(this.query);
      p = getClient()
        .query<GQL.FindScenesQuery>({
          query: GQL.FindScenesDocument,
          variables: {
            filter: {
              per_page: PER_PAGE,
              page: blockIndex + 1,
              sort,
              direction,
              q: this.searchQ,
              exclude_ids: excludeIds.length ? excludeIds : undefined,
            },
            scene_filter: buildSceneFilter(this.query),
          },
          fetchPolicy: "no-cache",
        })
        .then((r) => {
          const scenes = r.data.findScenes.scenes.map(mapScene);
          this.blockCache.set(blockIndex, scenes);
          return scenes;
        })
        .catch((e) => {
          // A failed block must not be cached as an empty page — drop the
          // in-flight promise so a retry refetches, and propagate the error.
          this.blockPromises.delete(blockIndex);
          throw e;
        });
      this.blockPromises.set(blockIndex, p);
    }
    return p;
  }

  async getPage(pageIndex: number): Promise<IVRHomePageResult> {
    const gen = this.generation;
    const [prefix, total] = await Promise.all([
      this.loadContinue(),
      this.loadTotal(),
    ]);
    const p = prefix.length;
    const excludeIds = prefix.map((s) => s.id);

    const start = pageIndex * PER_PAGE;
    const end = start + PER_PAGE;
    // Prefix cards in this page's virtual range [start, end).
    const prefixPart = prefix.slice(Math.min(start, p), Math.min(end, p));
    // Regular (date-ordered) cards: virtual index k maps to stream offset k - p.
    const regStart = Math.max(0, start - p);
    const regEnd = Math.max(0, end - p);
    const regular: IVRSceneEntry[] = [];
    if (regEnd > regStart) {
      const firstBlock = Math.floor(regStart / PER_PAGE);
      const lastBlock = Math.floor((regEnd - 1) / PER_PAGE);
      // eslint-disable-next-line no-await-in-loop
      for (let b = firstBlock; b <= lastBlock; b++) {
        // eslint-disable-next-line no-await-in-loop
        const blk = await this.fetchBlock(b, excludeIds);
        const blockStart = b * PER_PAGE;
        for (let i = 0; i < blk.length; i++) {
          const abs = blockStart + i;
          if (abs >= regStart && abs < regEnd) regular.push(blk[i]);
        }
      }
    }

    const scenes = [...prefixPart, ...regular];
    // Record virtual indices for auto-advance.
    for (let i = 0; i < scenes.length; i++) {
      this.indexById.set(scenes[i].id, start + i);
    }
    return { gen, pageIndex, scenes, totalCount: total };
  }

  async getCounts(): Promise<IVRHomeCounts> {
    // Counts ignore the media toggle (it's what they populate) but respect the
    // active studio/performer filter.
    const base = buildSceneFilter({ ...this.query, mediaFilter: "all" });
    const countOf = async (
      extra: Partial<GQL.SceneFilterType>
    ): Promise<number> => {
      try {
        const r = await getClient().query<GQL.FindScenesQuery>({
          query: GQL.FindScenesDocument,
          variables: {
            filter: { per_page: 0, page: 1, q: this.searchQ },
            scene_filter: { ...base, ...extra },
          },
          fetchPolicy: "no-cache",
        });
        return r.data.findScenes.count;
      } catch {
        return 0;
      }
    };
    const [all, vr, funscript] = await Promise.all([
      countOf({}),
      countOf({ vr_mode: { modifier: GQL.CriterionModifier.NotNull } }),
      countOf({ interactive: true }),
    ]);
    return { all, vr, flat: Math.max(0, all - vr), funscript };
  }

  async getRail(): Promise<IVRHomeRail> {
    const studiosP = getClient()
      .query<GQL.FindStudiosQuery>({
        query: GQL.FindStudiosDocument,
        variables: {
          filter: {
            per_page: RAIL_MAX,
            page: 1,
            sort: "scenes_count",
            direction: DESC,
          },
        },
      })
      .then((r) =>
        r.data.findStudios.studios
          .filter((s) => s.scene_count > 0)
          .map((s) => ({
            id: s.id,
            name: s.name,
            imageUrl: s.image_path ?? null,
            count: s.scene_count,
          }))
      )
      .catch(() => []);
    const performersP = getClient()
      .query<GQL.FindPerformersQuery>({
        query: GQL.FindPerformersDocument,
        variables: {
          filter: {
            per_page: RAIL_MAX,
            page: 1,
            sort: "scenes_count",
            direction: DESC,
          },
        },
      })
      .then((r) =>
        r.data.findPerformers.performers
          .filter((p) => p.scene_count > 0)
          .map((p) => ({
            id: p.id,
            name: p.name,
            imageUrl: p.image_path ?? null,
            count: p.scene_count,
          }))
      )
      .catch(() => []);
    const [studios, performers] = await Promise.all([studiosP, performersP]);
    return { studios, performers };
  }

  async getNextSceneId(currentId: string): Promise<string | null> {
    const idx = this.indexById.get(currentId);
    if (idx === undefined) return null;
    const total = await this.loadTotal();
    const nextIdx = idx + 1;
    if (nextIdx >= total) return null;
    const page = await this.getPage(Math.floor(nextIdx / PER_PAGE));
    if (page.gen !== this.generation) return null;
    const slot = nextIdx % PER_PAGE;
    return page.scenes[slot]?.id ?? null;
  }
}
