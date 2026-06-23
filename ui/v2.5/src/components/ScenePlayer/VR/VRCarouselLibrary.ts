/**
 * VRCarouselLibrary — server-paged data source for the peripheral Browse
 * "Scenes" carousel.
 *
 * The carousel shows VR-capable scenes (it's built for dome playback, not flat
 * content), newest first, excluding whatever scene is currently playing. Like
 * the Home wall ([VRHomeLibrary]) it pages on the server via `findScenes` rather
 * than loading a capped slice into memory, so it scales to any library size.
 *
 * It is deliberately much smaller than the Home library: one fixed query (VR
 * only, date desc), no rail / counts / continue-watching prefix, and a single
 * `excludeId` (the now-playing scene) the server filters out — so the list never
 * needs the client-side splicing the old fixed-50 carousel relied on. It is
 * generation-guarded: [setExcludeId] bumps a counter and clears the caches so a
 * page response that lands after the playing scene changed can be dropped.
 */
import * as GQL from "src/core/generated-graphql";
import { getClient } from "src/core/StashService";
import { IVRSceneEntry } from "./VRScenesPanel";
import { mapScene } from "./vrHomeLibrary";

/** Scenes fetched per network block; the panel grows by appending these. */
const PER_PAGE = 12;
const DESC = GQL.SortDirectionEnum.Desc;

export interface IVRCarouselPage {
  /** Generation the page was fetched under — stale results (gen mismatch) are dropped. */
  gen: number;
  pageIndex: number;
  scenes: IVRSceneEntry[];
  /** Total VR scenes matching the query (upper bound; the panel also stops on an empty page). */
  totalCount: number;
}

export class VRCarouselLibrary {
  private generation = 0;
  private excludeId: string | null = null;
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

  private loadTotal(): Promise<number> {
    if (this.totalForQuery >= 0) return Promise.resolve(this.totalForQuery);
    if (!this.totalPromise) {
      this.totalPromise = getClient()
        .query<GQL.FindScenesQuery>({
          query: GQL.FindScenesDocument,
          variables: {
            filter: { per_page: 0, page: 1, exclude_ids: this.excludeIds },
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
      p = getClient()
        .query<GQL.FindScenesQuery>({
          query: GQL.FindScenesDocument,
          variables: {
            filter: {
              per_page: PER_PAGE,
              page: blockIndex + 1,
              sort: "date",
              direction: DESC,
              exclude_ids: this.excludeIds,
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
