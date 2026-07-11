/**
 * Persisted Home-wall browse state (device-local, localStorage).
 *
 * Restores the last sort mode, media toggle and studio/performer/tag filter
 * when the immersive lobby reopens — with a large library, landing back where
 * you last browsed beats a clean slate. Free-text search is intentionally
 * session-only (a stale search restored days later reads as a broken library).
 *
 * Follows the same defensive load/save pattern as the VR settings blob in
 * ImmersiveVRPlayer: never throw (private mode / quota), treat unparseable
 * state as absent.
 */
import { VRMediaFilter, VRSortMode } from "./types";

export interface IVRBrowseFilter {
  kind: "studio" | "performer" | "tag";
  id: string;
  /** Display name for the filter pill; null if it was never resolved. */
  label: string | null;
}

export interface IVRBrowseState {
  sort: VRSortMode;
  media: VRMediaFilter;
  filter: IVRBrowseFilter | null;
}

const KEY = "vexxx-vr-browse-state";

const SORTS: VRSortMode[] = ["recent", "rating", "title"];
const MEDIA: VRMediaFilter[] = ["all", "vr", "flat", "funscript", "favorites"];
const KINDS = ["studio", "performer", "tag"] as const;

export function loadBrowseState(): Partial<IVRBrowseState> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const s = JSON.parse(raw) as Partial<IVRBrowseState>;
    const out: Partial<IVRBrowseState> = {};
    if (s.sort && SORTS.includes(s.sort)) out.sort = s.sort;
    if (s.media && MEDIA.includes(s.media)) out.media = s.media;
    if (
      s.filter &&
      KINDS.includes(s.filter.kind) &&
      typeof s.filter.id === "string"
    ) {
      out.filter = {
        kind: s.filter.kind,
        id: s.filter.id,
        label: typeof s.filter.label === "string" ? s.filter.label : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveBrowseState(s: IVRBrowseState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Best-effort (private mode / quota) — browsing still works unsaved.
  }
}
