/**
 * VRCarouselLibrary — server-paged data source for the peripheral Browse
 * "Scenes" carousel.
 *
 * The carousel shows VR-capable scenes (it's built for dome playback, not flat
 * content), excluding whatever scene is currently playing. Like the Home wall
 * ([VRHomeLibrary]) it pages on the server via `findScenes` rather than loading
 * a capped slice into memory, so it scales to any library size.
 *
 * It is deliberately smaller than the Home library: VR-only (no media-type
 * toggle — matching content, not swapping it, is the point of a mid-playback
 * "what else can I watch" list), no rail / counts / continue-watching prefix.
 * It does support free-text search + the same three sort modes as the Home
 * wall (recent/rating/title). Generation-guarded: [setQuery] bumps a counter
 * and clears the caches so a page response that lands after a query change
 * can be dropped.
 */
import * as GQL from "src/core/generated-graphql";
import { getClient } from "src/core/StashService";
import { IVRSceneEntry } from "./VRScenesPanel";
import { mapScene } from "./vrHomeLibrary";

/** Scenes fetched per network block; the panel grows by appending these. */
const PER_PAGE = 12;
const DESC = GQL.SortDirectionEnum.Desc;
const ASC = GQL.SortDirectionEnum.Asc;

export interface IVRCarouselPage {
  /** Generation the page was fetched under — stale results (gen mismatch) are dropped. */
  gen: number;
  pageIndex: number;
  scenes: IVRSceneEntry[];
  /** Total VR scenes matching the query (upper bound; the panel also stops on an empty page). */
  totalCount: number;
}

export interface IVRCarouselQuery {
  sort: "recent" | "rating" | "title";
  search: string | null;
}

export class VRCarouselLibrary {
  private generation = 0;
  private excludeId: string | null = null;
  private query: IVRCarouselQuery = { sort: "recent", search: null };
  private blockCache = new Map<number, IVRSceneEntry[]>();
  private blockPromises = new Map<number, Promise<IVRSceneEntry[]>>();
  private totalForQuery = -1;
  private totalPromise: Promise<number> | null = null;

  get gen(): number {
    return this.generation;
  }

  /**
   * Set the now-playing scene to exclude from the list. Bumps the generation and
   * clears the caches so the list re-pages without that scene. Returns the new
   * generation. A no-op (same id) keeps the current generation + caches.
   */
  setExcludeId(id: string | null): number {
    const norm = id || null;
    if (norm === this.excludeId) return this.generation;
    this.excludeId = norm;
    return this.bumpAndClear();
  }

  /** Apply a new sort/search query. Bumps the generation and clears the caches. */
  setQuery(q: IVRCarouselQuery): number {
    this.query = q;
    return this.bumpAndClear();
  }

  private bumpAndClear(): number {
    this.generation++;
    this.blockCache.clear();
    this.blockPromises.clear();
    this.totalForQuery = -1;
    this.totalPromise = null;
    return this.generation;
  }

  private sceneFilter(): GQL.SceneFilterType {
    return { vr_mode: { modifier: GQL.CriterionModifier.NotNull } };
  }

  private get excludeIds(): string[] | undefined {
    return this.excludeId ? [this.excludeId] : undefined;
  }

  private get searchQ(): string | undefined {
    const s = this.query.search?.trim();
    return s ? s : undefined;
  }

  private get sortKey(): { sort: string; direction: GQL.SortDirectionEnum } {
    if (this.query.sort === "rating") return { sort: "rating", direction: DESC };
    if (this.query.sort === "title") return { sort: "title", direction: ASC };
    return { sort: "date", direction: DESC };
  }

  private loadTotal(): Promise<number> {
    if (this.totalForQuery >= 0) return Promise.resolve(this.totalForQuery);
    if (!this.totalPromise) {
      this.totalPromise = getClient()
        .query<GQL.FindScenesQuery>({
          query: GQL.FindScenesDocument,
          variables: {
            filter: {
              per_page: 0,
              page: 1,
              exclude_ids: this.excludeIds,
              q: this.searchQ,
            },
            scene_filter: this.sceneFilter(),
          },
          fetchPolicy: "network-only",
        })
        .then((r) => {
          this.totalForQuery = r.data.findScenes.count;
          return this.totalForQuery;
        })
        .catch(() => {
          this.totalForQuery = 0;
          return 0;
        });
    }
    return this.totalPromise;
  }

  private fetchBlock(blockIndex: number): Promise<IVRSceneEntry[]> {
    const cached = this.blockCache.get(blockIndex);
    if (cached) return Promise.resolve(cached);
    let p = this.blockPromises.get(blockIndex);
    if (!p) {
      const { sort, direction } = this.sortKey;
      p = getClient()
        .query<GQL.FindScenesQuery>({
          query: GQL.FindScenesDocument,
          variables: {
            filter: {
              per_page: PER_PAGE,
              page: blockIndex + 1,
              sort,
              direction,
              exclude_ids: this.excludeIds,
              q: this.searchQ,
            },
            scene_filter: this.sceneFilter(),
          },
          fetchPolicy: "network-only",
        })
        .then((r) => {
          const scenes = r.data.findScenes.scenes.map(mapScene);
          this.blockCache.set(blockIndex, scenes);
          return scenes;
        })
        .catch(() => {
          const empty: IVRSceneEntry[] = [];
          this.blockCache.set(blockIndex, empty);
          return empty;
        });
      this.blockPromises.set(blockIndex, p);
    }
    return p;
  }

  /** Fetch one page (block) of the carousel under the current exclude. */
  async getPage(pageIndex: number): Promise<IVRCarouselPage> {
    const gen = this.generation;
    const [scenes, totalCount] = await Promise.all([
      this.fetchBlock(pageIndex),
      this.loadTotal(),
    ]);
    return { gen, pageIndex, scenes, totalCount };
  }
}
