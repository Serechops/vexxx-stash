import React, { useEffect, useMemo, useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import { PatchComponent } from "src/patch";
import {
  RawCard,
  RawDetail,
  RawListResult,
  RawRailEntry,
  faptapFavorites,
  fetchFaptapStatus,
  getJSON,
  proxyIfNeeded,
} from "src/components/ScenePlayer/VR/faptapLibrary";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";

const PER_PAGE = 24;

type MediaFilter = "all" | "vr" | "flat" | "funscript" | "favorites";
type SortKey = "recent" | "rating" | "title";

const MEDIA_FILTERS: { key: MediaFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "vr", label: "VR" },
  { key: "flat", label: "Flat" },
  { key: "funscript", label: "Interactive" },
  { key: "favorites", label: "Favorites" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "rating", label: "Rating" },
  { key: "title", label: "Title" },
];

function formatDuration(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return "";
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

/** Debounce a changing value; used for the free-text search box. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const FapTapCard = PatchComponent(
  "FapTap.Card",
  ({ card, onOpen }: { card: RawCard; onOpen: (id: string) => void }) => {
    const [hovered, setHovered] = useState(false);
    const [fav, setFav] = useState(() => faptapFavorites.has(card.id));
    const thumb = proxyIfNeeded(card.thumbnail_url);
    const preview = proxyIfNeeded(card.preview_url);

    return (
      <div
        className="group relative cursor-pointer overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-800 transition hover:ring-zinc-500"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onOpen(card.id)}
      >
        <div className="relative aspect-video w-full bg-black">
          {thumb && (
            <img
              src={thumb}
              alt={card.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
          {hovered && preview && (
            <video
              src={preview}
              muted
              loop
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {/* badges */}
          <div className="absolute left-1.5 top-1.5 flex gap-1">
            {card.vr && (
              <span className="rounded bg-indigo-600/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                VR
              </span>
            )}
            {card.has_funscript && (
              <span className="rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                Script
              </span>
            )}
          </div>
          {card.duration > 0 && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-zinc-100">
              {formatDuration(card.duration)}
            </span>
          )}
          <button
            className={`absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1.5 text-sm leading-none transition ${
              fav ? "text-rose-500" : "text-zinc-300 opacity-0 group-hover:opacity-100"
            }`}
            title={fav ? "Remove from favorites" : "Add to favorites"}
            onClick={(e) => {
              e.stopPropagation();
              setFav(faptapFavorites.toggle(card.id));
            }}
          >
            {fav ? "♥" : "♡"}
          </button>
        </div>
        <div className="p-2">
          <div className="truncate text-sm font-medium text-zinc-100" title={card.name}>
            {card.name || `FapTap ${card.id}`}
          </div>
          {card.tags?.length > 0 && (
            <div className="mt-1 truncate text-xs text-zinc-500">
              {card.tags.map((t) => t.name).join(" · ")}
            </div>
          )}
        </div>
      </div>
    );
  }
);

export const FapTapGrid: React.FC = () => {
  const history = useHistory();

  const [available, setAvailable] = useState<boolean | null>(null);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const [cards, setCards] = useState<RawCard[]>([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<RawRailEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const debouncedSearch = useDebounced(search, 300);
  // bump on every filter change so stale responses can't clobber newer ones
  const generation = useRef(0);

  useEffect(() => {
    fetchFaptapStatus().then((s) => setAvailable(s.available));
    getJSON<RawRailEntry[]>("tags", { limit: "200" })
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  // reset paging when any filter changes
  useEffect(() => {
    setPage(0);
  }, [media, sort, tag, debouncedSearch]);

  useEffect(() => {
    if (available === false) return;
    const gen = ++generation.current;
    setLoading(true);

    async function load() {
      if (media === "favorites") {
        // favorites live in localStorage; page them client-side
        const ids = faptapFavorites.list();
        const pageIds = ids.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
        const details = await Promise.all(
          pageIds.map((id) =>
            getJSON<RawDetail>(`videos/${id}`).catch(() => null)
          )
        );
        return {
          videos: details.filter((d): d is RawDetail => d != null),
          total: ids.length,
        };
      }
      return getJSON<RawListResult>("videos", {
        page: String(page + 1),
        per_page: String(PER_PAGE),
        media,
        sort,
        tag,
        q: debouncedSearch.trim(),
      });
    }

    load()
      .then((res) => {
        if (gen !== generation.current) return;
        setCards(res.videos);
        setTotal(res.total);
      })
      .catch(() => {
        if (gen !== generation.current) return;
        setCards([]);
        setTotal(0);
      })
      .finally(() => {
        if (gen === generation.current) setLoading(false);
      });
  }, [available, media, sort, tag, debouncedSearch, page]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total]);

  if (available === null) {
    return <LoadingIndicator />;
  }
  if (available === false) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center text-zinc-400">
        <h1 className="mb-3 text-2xl font-semibold text-zinc-200">FapTap</h1>
        <p>
          The FapTap sidecar database was not found. Point the FapTap VR
          plugin&apos;s “Data Folder” setting at the folder containing{" "}
          <code>faptap_data.db</code> and reload.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-zinc-950 px-4 py-6 text-zinc-100 md:px-10">
      {/* header + search */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">FapTap</h1>
        <span className="text-sm text-zinc-500">{total} videos</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="ml-auto w-full max-w-xs rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-400"
        />
      </div>

      {/* filter toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {MEDIA_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setMedia(f.key)}
            className={`rounded-full px-3 py-1 text-sm transition ${
              media === f.key
                ? "bg-zinc-100 font-medium text-zinc-900"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {f.label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="ml-2 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </select>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.count})
            </option>
          ))}
        </select>
      </div>

      {/* grid */}
      {loading ? (
        <LoadingIndicator />
      ) : cards.length === 0 ? (
        <div className="py-24 text-center text-zinc-500">No videos match.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {cards.map((c) => (
            <FapTapCard
              key={c.id}
              card={c}
              onOpen={(id) => history.push(`/faptap/${id}`)}
            />
          ))}
        </div>
      )}

      {/* pagination */}
      {pageCount > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-zinc-200 transition enabled:hover:bg-zinc-700 disabled:opacity-40"
          >
            ‹ Prev
          </button>
          <span className="text-zinc-400">
            Page {page + 1} / {pageCount}
          </span>
          <button
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-zinc-200 transition enabled:hover:bg-zinc-700 disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
};
