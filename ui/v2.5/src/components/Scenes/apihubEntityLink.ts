/**
 * Scene cards can render the API Hub plugin's synthetic premium-catalog
 * scenes (performer/tag/studio ids like "apihub-performer-aylo:brazzers-72721"
 * or "apihub-ea-tag-Anal"). Those aren't rows in the local database, so the
 * real /performers, /tags, /studios pages 500 (strconv.Atoi on a non-numeric
 * id) when clicked. Route those clicks back into the API Hub grid instead,
 * pre-filtered to that performer/tag/studio within its own network.
 *
 * Returns null for ordinary numeric-id entities so callers fall back to their
 * normal /performers|/tags|/studios navigation unchanged.
 */
// Networks whose catalog has no stable numeric id for performers/tags/studios
// (EvilAngel/Adult Time/TeamSkeet all key their synthetic ids off the exact
// facet name instead) — each maps its short id-prefix to the plugin's tab key.
const NAME_BASED_NETWORKS: Record<string, string> = {
  ea: "evilangel",
  at: "adulttime",
  ts: "teamskeet",
};

export function apihubEntityLink(
  kind: "performer" | "tag" | "studio",
  id: string | undefined | null
): string | null {
  if (!id) return null;

  for (const [shortKey, network] of Object.entries(NAME_BASED_NETWORKS)) {
    const namePrefix = `apihub-${shortKey}-${kind}-`;
    if (id.startsWith(namePrefix)) {
      const name = decodeURIComponent(id.slice(namePrefix.length));
      if (!name) return null;
      return `/plugins/apihub?network=${network}&${kind}=${encodeURIComponent(name)}`;
    }
  }

  const prefix = `apihub-${kind}-`;
  if (id.startsWith(prefix)) {
    const rest = id.slice(prefix.length); // "<brandKey>-<numericId>"
    const lastDash = rest.lastIndexOf("-");
    if (lastDash === -1) return null;
    const brandKey = rest.slice(0, lastDash);
    const numId = rest.slice(lastDash + 1);
    if (!brandKey || !numId) return null;
    const field =
      kind === "tag" ? "tagId" : kind === "studio" ? "collectionId" : "actorId";
    return `/plugins/apihub?network=${encodeURIComponent(brandKey)}&${field}=${encodeURIComponent(numId)}`;
  }

  return null;
}
