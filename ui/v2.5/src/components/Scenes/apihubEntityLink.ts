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
// Networks whose synthetic ids don't fit the generic "apihub-<kind>-<brandKey>-
// <numId>" shape below — EvilAngel/Adult Time/TeamSkeet key off the exact facet
// name (no stable numeric id), while NewSensations ("ns") keys off a real
// numeric id but with its short prefix at the front instead of a brandKey in
// the middle ("apihub-ns-tag-123", not "apihub-tag-newsensations-123") — same
// decode either way (strip the prefix, keep whatever's left as the `id`/`tag`/
// `performer`/`studio` query value), so it reuses this branch too.
const NAME_BASED_NETWORKS: Record<string, string> = {
  ea: "evilangel",
  at: "adulttime",
  ts: "teamskeet",
  ns: "newsensations",
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
