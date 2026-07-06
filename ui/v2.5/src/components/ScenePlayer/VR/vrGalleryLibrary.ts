/**
 * VRGalleryLibrary — server-backed data source for the immersive Home wall's
 * Galleries mode and the in-headset XR gallery viewer.
 *
 * Like [VRHomeLibrary] for scenes, this pages + sorts + filters galleries on the
 * server via `findGalleries` so the wall scales to libraries of any size, and
 * pages the *active gallery's* images via `findImages` (filtered to that gallery)
 * for the thumbnail grid + lightbox. Galleries reuse the Home query's sort +
 * studio/performer/tag filter (the media toggle is irrelevant to galleries).
 *
 * Everything is generation-guarded: [setQuery] (gallery query) and
 * [setActiveGallery] (image scope) both bump a single counter and clear the
 * relevant caches; each page result carries the generation it was fetched under
 * so the manager can drop stale responses that land after a switch.
 */
import * as GQL from "src/core/generated-graphql";
import { getClient } from "src/core/StashService";
import {
  IVRGalleryDataSource,
  IVRGalleryEntry,
  IVRGalleryImageEntry,
  IVRGalleryImagePageResult,
  IVRGalleryPageResult,
  IVRHomeQuery,
  VR_GALLERY_PAGE_SIZE,
} from "./types";

/** One Home-wall gallery grid page — from the shared layout contract in types.ts. */
const GALLERY_PER_PAGE = VR_GALLERY_PAGE_SIZE;
/** Image grid is 5×3 — must match PER_PAGE in VRGalleryViewerPanel. */
const IMAGE_PER_PAGE = 15;

const DESC = GQL.SortDirectionEnum.Desc;
const ASC = GQL.SortDirectionEnum.Asc;
const INCLUDES = GQL.CriterionModifier.Includes;

type SlimGallery = GQL.FindGalleriesQuery["findGalleries"]["galleries"][number];
type SlimImage = GQL.FindImagesQuery["findImages"]["images"][number];

/** Basename of a filesystem path (handles both / and \ separators). */
function basename(p: string | undefined | null): string | null {
  if (!p) return null;
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

/** Map a slim gallery fragment onto the cover tile the Home wall renders. */
export function mapGallery(g: SlimGallery): IVRGalleryEntry {
  const title =
    g.title ||
    g.folder?.basename ||
    basename(g.files[0]?.path) ||
    `Gallery ${g.id}`;
  return {
    id: g.id,
    title,
    coverUrl: g.paths.cover ?? null,
    imageCount: g.image_count ?? 0,
    studioName: g.studio?.name ?? null,
    studioLogoUrl: g.studio?.image_path ?? null,
    rating: g.rating100 ?? null,
    date: g.date ?? null,
    performers: g.performers.map((p) => p.name),
    performerDetails: g.performers.map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.image_path ?? null,
    })),
    tags: g.tags.map((t) => ({ id: t.id, name: t.name })),
  };
}

/** Map a slim image fragment onto the thumbnail/lightbox entry the viewer renders. */
export function mapImage(im: SlimImage): IVRGalleryImageEntry {
  return {
    id: im.id,
    title: im.title || `Image ${im.id}`,
    thumbnailUrl: im.paths.thumbnail ?? null,
    imageUrl: im.paths.image ?? null,
    previewUrl: im.paths.preview ?? null,
  };
}

/** Build the GalleryFilterType for the active studio/performer/tag filter. */
function buildGalleryFilter(q: IVRHomeQuery): GQL.GalleryFilterType {
  const f: GQL.GalleryFilterType = {};
  if (q.filter?.kind === "studio") {
    f.studios = { value: [q.filter.id], modifier: INCLUDES, depth: 0 };
  } else if (q.filter?.kind === "performer") {
    f.performers = { value: [q.filter.id], modifier: INCLUDES };
  } else if (q.filter?.kind === "tag") {
    f.tags = { value: [q.filter.id], modifier: INCLUDES, depth: 0 };
  }
  return f;
}

/** Free-text search term for the find filter's `q`, or undefined when off. */
function searchQ(q: IVRHomeQuery): string | undefined {
  const s = q.search?.trim();
  return s ? s : undefined;
}

/** Map the Home sort mode onto a gallery sort key + direction. */
function gallerySort(q: IVRHomeQuery): {
  sort: string;
  direction: GQL.SortDirectionEnum;
} {
  if (q.sort === "rating") return { sort: "rating", direction: DESC };
  if (q.sort === "title") return { sort: "title", direction: ASC };
  return { sort: "date", direction: DESC };
}

export class VRGalleryLibrary implements IVRGalleryDataSource {
  private query: IVRHomeQuery = {
    sort: "recent",
    mediaFilter: "all",
    filter: null,
    search: null,
  };
  private generation = 0;

  // Gallery grid: cached one GALLERY_PER_PAGE block at a time.
  private galleryBlocks = new Map<number, IVRGalleryEntry[]>();
  private galleryBlockPromises = new Map<number, Promise<IVRGalleryEntry[]>>();
  private galleryTotal = -1;
  private galleryTotalPromise: Promise<number> | null = null;

  // Active gallery's images: cached one IMAGE_PER_PAGE block at a time.
  private activeGalleryId: string | null = null;
  private imageBlocks = new Map<number, IVRGalleryImageEntry[]>();
  private imageBlockPromises = new Map<number, Promise<IVRGalleryImageEntry[]>>();
  private imageTotal = -1;
  private imageTotalPromise: Promise<number> | null = null;

  get gen(): number {
    return this.generation;
  }

  setQuery(q: IVRHomeQuery): number {
    this.query = q;
    this.generation++;
    this.galleryBlocks.clear();
    this.galleryBlockPromises.clear();
    this.galleryTotal = -1;
    this.galleryTotalPromise = null;
    return this.generation;
  }

  setActiveGallery(galleryId: string | null): number {
    if (galleryId !== this.activeGalleryId) {
      this.activeGalleryId = galleryId;
      this.imageBlocks.clear();
      this.imageBlockPromises.clear();
      this.imageTotal = -1;
      this.imageTotalPromise = null;
    }
    this.generation++;
    return this.generation;
  }

  // ── Gallery grid ──────────────────────────────────────────────────────────

  getGalleryTotal(): Promise<number> {
    if (this.galleryTotal >= 0) return Promise.resolve(this.galleryTotal);
    if (!this.galleryTotalPromise) {
      this.galleryTotalPromise = getClient()
        .query<GQL.FindGalleriesQuery>({
          query: GQL.FindGalleriesDocument,
          variables: {
            filter: { per_page: 0, page: 1, q: searchQ(this.query) },
            gallery_filter: buildGalleryFilter(this.query),
          },
          fetchPolicy: "network-only",
        })
        .then((r) => {
          this.galleryTotal = r.data.findGalleries.count;
          return this.galleryTotal;
        })
        .catch(() => {
          this.galleryTotal = 0;
          return 0;
        });
    }
    return this.galleryTotalPromise;
  }

  private fetchGalleryBlock(blockIndex: number): Promise<IVRGalleryEntry[]> {
    const cached = this.galleryBlocks.get(blockIndex);
    if (cached) return Promise.resolve(cached);
    let p = this.galleryBlockPromises.get(blockIndex);
    if (!p) {
      const { sort, direction } = gallerySort(this.query);
      p = getClient()
        .query<GQL.FindGalleriesQuery>({
          query: GQL.FindGalleriesDocument,
          variables: {
            filter: {
              per_page: GALLERY_PER_PAGE,
              page: blockIndex + 1,
              sort,
              direction,
              q: searchQ(this.query),
            },
            gallery_filter: buildGalleryFilter(this.query),
          },
          fetchPolicy: "network-only",
        })
        .then((r) => {
          const galleries = r.data.findGalleries.galleries.map(mapGallery);
          this.galleryBlocks.set(blockIndex, galleries);
          return galleries;
        })
        .catch(() => {
          const empty: IVRGalleryEntry[] = [];
          this.galleryBlocks.set(blockIndex, empty);
          return empty;
        });
      this.galleryBlockPromises.set(blockIndex, p);
    }
    return p;
  }

  async getGalleryPage(pageIndex: number): Promise<IVRGalleryPageResult> {
    const gen = this.generation;
    const [galleries, totalCount] = await Promise.all([
      this.fetchGalleryBlock(pageIndex),
      this.getGalleryTotal(),
    ]);
    return { gen, pageIndex, galleries, totalCount };
  }

  // ── Active gallery's images ─────────────────────────────────────────────────

  getImageTotal(): Promise<number> {
    if (!this.activeGalleryId) return Promise.resolve(0);
    if (this.imageTotal >= 0) return Promise.resolve(this.imageTotal);
    if (!this.imageTotalPromise) {
      const galleryId = this.activeGalleryId;
      this.imageTotalPromise = getClient()
        .query<GQL.FindImagesQuery>({
          query: GQL.FindImagesDocument,
          variables: {
            filter: { per_page: 0, page: 1 },
            image_filter: {
              galleries: { value: [galleryId], modifier: INCLUDES },
            },
          },
          fetchPolicy: "network-only",
        })
        .then((r) => {
          this.imageTotal = r.data.findImages.count;
          return this.imageTotal;
        })
        .catch(() => {
          this.imageTotal = 0;
          return 0;
        });
    }
    return this.imageTotalPromise;
  }

  private fetchImageBlock(blockIndex: number): Promise<IVRGalleryImageEntry[]> {
    if (!this.activeGalleryId) return Promise.resolve([]);
    const cached = this.imageBlocks.get(blockIndex);
    if (cached) return Promise.resolve(cached);
    let p = this.imageBlockPromises.get(blockIndex);
    if (!p) {
      const galleryId = this.activeGalleryId;
      p = getClient()
        .query<GQL.FindImagesQuery>({
          query: GQL.FindImagesDocument,
          variables: {
            filter: {
              per_page: IMAGE_PER_PAGE,
              page: blockIndex + 1,
              // Natural gallery order: images sorted by file path ascending.
              sort: "path",
              direction: ASC,
            },
            image_filter: {
              galleries: { value: [galleryId], modifier: INCLUDES },
            },
          },
          fetchPolicy: "network-only",
        })
        .then((r) => {
          const images = r.data.findImages.images.map(mapImage);
          this.imageBlocks.set(blockIndex, images);
          return images;
        })
        .catch(() => {
          const empty: IVRGalleryImageEntry[] = [];
          this.imageBlocks.set(blockIndex, empty);
          return empty;
        });
      this.imageBlockPromises.set(blockIndex, p);
    }
    return p;
  }

  async getImagePage(pageIndex: number): Promise<IVRGalleryImagePageResult> {
    const gen = this.generation;
    const [images, totalCount] = await Promise.all([
      this.fetchImageBlock(pageIndex),
      this.getImageTotal(),
    ]);
    return { gen, pageIndex, images, totalCount };
  }
}
