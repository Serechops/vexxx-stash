/**
 * VRGroupLibrary — server-backed data source for the immersive Home wall's
 * Movies (Groups) mode.
 *
 * Like [VRGalleryLibrary] for galleries, this pages + sorts + filters groups on
 * the server via `findGroups` so the wall scales to libraries of any size. When
 * a movie is drilled into, its scenes are fetched in a single `findScenes` call
 * (groups hold few scenes, unlike a gallery's thousands of images) and ordered
 * by `scene_index` — the per-scene "scene number" within the group — with a
 * server-order fallback for scenes that carry no index. The cached, sorted list
 * is then sliced into pages so the Home wall can reuse its scene-card grid.
 *
 * Everything is generation-guarded: [setQuery] (group query) and
 * [setActiveGroup] (scene scope) both bump a single counter; each page result
 * carries the generation it was fetched under so the manager can drop stale
 * responses that land after a switch.
 */
import * as GQL from "src/core/generated-graphql";
import { getClient } from "src/core/StashService";
import { IVRSceneEntry } from "./VRScenesPanel";
import { mapScene } from "./vrHomeLibrary";
import {
  IVRGroupDataSource,
  IVRGroupEntry,
  IVRGroupPageResult,
  IVRGroupScenePageResult,
  IVRHomeQuery,
} from "./types";

/** Movie poster grid is 6×2 — must match GROUP_PER_PAGE in VRHomePanel. */
const GROUP_PER_PAGE = 12;
/** A drilled-in movie's scene grid is 3×2 — must match the scene PER_PAGE in VRHomePanel. */
const SCENE_PER_PAGE = 6;

const DESC = GQL.SortDirectionEnum.Desc;
const ASC = GQL.SortDirectionEnum.Asc;
const INCLUDES = GQL.CriterionModifier.Includes;

type SlimGroup = GQL.FindGroupsQuery["findGroups"]["groups"][number];
type SlimScene = GQL.FindScenesQuery["findScenes"]["scenes"][number];

/** Map a slim group fragment onto the poster tile the Home wall renders. */
export function mapGroup(g: SlimGroup): IVRGroupEntry {
  return {
    id: g.id,
    title: g.name || `Movie ${g.id}`,
    posterUrl: g.front_image_path ?? null,
    sceneCount: g.scene_count ?? 0,
    studioName: g.studio?.name ?? null,
    rating: g.rating100 ?? null,
    date: g.date ?? null,
    backUrl: g.back_image_path ?? null,
  };
}

/** Build the GroupFilterType for the active studio/performer filter. */
function buildGroupFilter(q: IVRHomeQuery): GQL.GroupFilterType {
  const f: GQL.GroupFilterType = {};
  if (q.filter?.kind === "studio") {
    f.studios = { value: [q.filter.id], modifier: INCLUDES, depth: 0 };
  } else if (q.filter?.kind === "performer") {
    f.performers = { value: [q.filter.id], modifier: INCLUDES };
  }
  // Groups have no tag filter — a tag filter (info-panel drill-down) simply
  // leaves the movie grid unfiltered.
  return f;
}

/** Free-text search term for the find filter's `q`, or undefined when off. */
function searchQ(q: IVRHomeQuery): string | undefined {
  const s = q.search?.trim();
  return s ? s : undefined;
}

/** Map the Home sort mode onto a group sort key + direction. */
function groupSort(q: IVRHomeQuery): {
  sort: string;
  direction: GQL.SortDirectionEnum;
} {
  if (q.sort === "rating") return { sort: "rating", direction: DESC };
  if (q.sort === "title") return { sort: "name", direction: ASC };
  return { sort: "date", direction: DESC };
}

export class VRGroupLibrary implements IVRGroupDataSource {
  private query: IVRHomeQuery = {
    sort: "recent",
    mediaFilter: "all",
    filter: null,
    search: null,
  };
  private generation = 0;

  // Movie poster grid: cached one GROUP_PER_PAGE block at a time.
  private groupBlocks = new Map<number, IVRGroupEntry[]>();
  private groupBlockPromises = new Map<number, Promise<IVRGroupEntry[]>>();
  private groupTotal = -1;
  private groupTotalPromise: Promise<number> | null = null;

  // Active movie's scenes: the whole group is fetched + sorted once, then sliced.
  private activeGroupId: string | null = null;
  private sceneList: IVRSceneEntry[] | null = null;
  private scenePromise: Promise<IVRSceneEntry[]> | null = null;

  get gen(): number {
    return this.generation;
  }

  setQuery(q: IVRHomeQuery): number {
    this.query = q;
    this.generation++;
    this.groupBlocks.clear();
    this.groupBlockPromises.clear();
    this.groupTotal = -1;
    this.groupTotalPromise = null;
    return this.generation;
  }

  setActiveGroup(groupId: string | null): number {
    if (groupId !== this.activeGroupId) {
      this.activeGroupId = groupId;
      this.sceneList = null;
      this.scenePromise = null;
    }
    this.generation++;
    return this.generation;
  }

  // ── Movie poster grid ───────────────────────────────────────────────────────

  getGroupTotal(): Promise<number> {
    if (this.groupTotal >= 0) return Promise.resolve(this.groupTotal);
    if (!this.groupTotalPromise) {
      this.groupTotalPromise = getClient()
        .query<GQL.FindGroupsQuery>({
          query: GQL.FindGroupsDocument,
          variables: {
            filter: { per_page: 0, page: 1, q: searchQ(this.query) },
            group_filter: buildGroupFilter(this.query),
          },
          fetchPolicy: "network-only",
        })
        .then((r) => {
          this.groupTotal = r.data.findGroups.count;
          return this.groupTotal;
        })
        .catch(() => {
          this.groupTotal = 0;
          return 0;
        });
    }
    return this.groupTotalPromise;
  }

  private fetchGroupBlock(blockIndex: number): Promise<IVRGroupEntry[]> {
    const cached = this.groupBlocks.get(blockIndex);
    if (cached) return Promise.resolve(cached);
    let p = this.groupBlockPromises.get(blockIndex);
    if (!p) {
      const { sort, direction } = groupSort(this.query);
      p = getClient()
        .query<GQL.FindGroupsQuery>({
          query: GQL.FindGroupsDocument,
          variables: {
            filter: {
              per_page: GROUP_PER_PAGE,
              page: blockIndex + 1,
              sort,
              direction,
              q: searchQ(this.query),
            },
            group_filter: buildGroupFilter(this.query),
          },
          fetchPolicy: "network-only",
        })
        .then((r) => {
          const groups = r.data.findGroups.groups.map(mapGroup);
          this.groupBlocks.set(blockIndex, groups);
          return groups;
        })
        .catch(() => {
          const empty: IVRGroupEntry[] = [];
          this.groupBlocks.set(blockIndex, empty);
          return empty;
        });
      this.groupBlockPromises.set(blockIndex, p);
    }
    return p;
  }

  async getGroupPage(pageIndex: number): Promise<IVRGroupPageResult> {
    const gen = this.generation;
    const [groups, totalCount] = await Promise.all([
      this.fetchGroupBlock(pageIndex),
      this.getGroupTotal(),
    ]);
    return { gen, pageIndex, groups, totalCount };
  }

  // ── Active movie's scenes (ordered by scene_index) ──────────────────────────

  /**
   * Fetch every scene in the active group once and order it by `scene_index`
   * (the group's per-scene "scene number"); scenes lacking an index keep their
   * server (date) order and fall after the numbered ones. Groups hold few
   * scenes, so a single fetch + client sort is cheaper and correct vs. paging.
   */
  private loadScenes(): Promise<IVRSceneEntry[]> {
    if (!this.activeGroupId) return Promise.resolve([]);
    if (this.sceneList) return Promise.resolve(this.sceneList);
    if (!this.scenePromise) {
      const groupId = this.activeGroupId;
      this.scenePromise = getClient()
        .query<GQL.FindScenesQuery>({
          query: GQL.FindScenesDocument,
          variables: {
            // -1 = all scenes in the group (bounded — groups are small).
            filter: { per_page: -1, page: 1, sort: "date", direction: ASC },
            scene_filter: {
              groups: { value: [groupId], modifier: INCLUDES, depth: 0 },
            },
          },
          fetchPolicy: "network-only",
        })
        .then((r) => {
          const raw = r.data.findScenes.scenes as SlimScene[];
          // Pair each scene with its scene_index *for this group* (if any).
          const paired = raw.map((s, ordinal) => {
            const link = s.groups.find((g) => g.group.id === groupId);
            const idx = link?.scene_index ?? null;
            return { entry: mapScene(s), idx, ordinal };
          });
          paired.sort((a, b) => {
            // Numbered scenes first, ascending by scene_index.
            if (a.idx !== null && b.idx !== null) return a.idx - b.idx;
            if (a.idx !== null) return -1;
            if (b.idx !== null) return 1;
            // Neither numbered → preserve the server (date) order.
            return a.ordinal - b.ordinal;
          });
          const scenes = paired.map((p) => p.entry);
          this.sceneList = scenes;
          return scenes;
        })
        .catch(() => {
          this.sceneList = [];
          return [];
        });
    }
    return this.scenePromise;
  }

  async getSceneTotal(): Promise<number> {
    const scenes = await this.loadScenes();
    return scenes.length;
  }

  async getScenePage(pageIndex: number): Promise<IVRGroupScenePageResult> {
    const gen = this.generation;
    const all = await this.loadScenes();
    const start = pageIndex * SCENE_PER_PAGE;
    const scenes = all.slice(start, start + SCENE_PER_PAGE);
    return { gen, pageIndex, scenes, totalCount: all.length };
  }
}
