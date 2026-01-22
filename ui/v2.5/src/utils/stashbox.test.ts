import { describe, it, expect } from "vitest";
import { mergeStashIDs, getStashboxBase, stashboxDisplayName } from "./stashbox";

describe("stashbox utilities", () => {
  describe("stashboxDisplayName", () => {
    it("should return the name if provided", () => {
      expect(stashboxDisplayName("StashDB", 0)).toBe("StashDB");
      expect(stashboxDisplayName("My Stash-Box", 2)).toBe("My Stash-Box");
    });

    it("should return default name with 1-indexed number when name is empty", () => {
      expect(stashboxDisplayName("", 0)).toBe("Stash-Box #1");
      expect(stashboxDisplayName("", 1)).toBe("Stash-Box #2");
      expect(stashboxDisplayName("", 5)).toBe("Stash-Box #6");
    });
  });

  describe("getStashboxBase", () => {
    it("should extract base URL from graphql endpoint", () => {
      expect(getStashboxBase("https://stashdb.org/graphql")).toBe(
        "https://stashdb.org/"
      );
      expect(getStashboxBase("http://localhost:9999/graphql")).toBe(
        "http://localhost:9999/"
      );
      expect(
        getStashboxBase("https://my-stash.example.com/api/graphql")
      ).toBe("https://my-stash.example.com/api/");
    });

    it("should return undefined for non-graphql endpoints", () => {
      expect(getStashboxBase("https://stashdb.org/")).toBeUndefined();
      expect(getStashboxBase("https://stashdb.org/api")).toBeUndefined();
    });
  });

  describe("mergeStashIDs", () => {
    it("should return src when dest is empty", () => {
      const src = [{ endpoint: "https://stashdb.org", stash_id: "abc123" }];
      const result = mergeStashIDs([], src);
      expect(result).toEqual(src);
    });

    it("should return dest when src is empty", () => {
      const dest = [{ endpoint: "https://stashdb.org", stash_id: "abc123" }];
      const result = mergeStashIDs(dest, []);
      expect(result).toEqual(dest);
    });

    it("should merge stash IDs from different endpoints", () => {
      const dest = [{ endpoint: "https://stashdb.org", stash_id: "abc123" }];
      const src = [{ endpoint: "https://pmvstash.org", stash_id: "xyz789" }];
      const result = mergeStashIDs(dest, src);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        endpoint: "https://stashdb.org",
        stash_id: "abc123",
      });
      expect(result).toContainEqual({
        endpoint: "https://pmvstash.org",
        stash_id: "xyz789",
      });
    });

    it("should overwrite dest stash ID when src has same endpoint", () => {
      const dest = [{ endpoint: "https://stashdb.org", stash_id: "old-id" }];
      const src = [{ endpoint: "https://stashdb.org", stash_id: "new-id" }];
      const result = mergeStashIDs(dest, src);
      expect(result).toHaveLength(1);
      expect(result).toContainEqual({
        endpoint: "https://stashdb.org",
        stash_id: "new-id",
      });
    });

    it("should handle complex merge scenarios", () => {
      const dest = [
        { endpoint: "https://stashdb.org", stash_id: "stashdb-old" },
        { endpoint: "https://pmvstash.org", stash_id: "pmv-keep" },
        { endpoint: "https://custom.org", stash_id: "custom-keep" },
      ];
      const src = [
        { endpoint: "https://stashdb.org", stash_id: "stashdb-new" },
        { endpoint: "https://newbox.org", stash_id: "newbox-add" },
      ];
      const result = mergeStashIDs(dest, src);
      
      // Should have 4 entries: pmv-keep, custom-keep, stashdb-new, newbox-add
      expect(result).toHaveLength(4);
      expect(result).toContainEqual({
        endpoint: "https://stashdb.org",
        stash_id: "stashdb-new",
      });
      expect(result).toContainEqual({
        endpoint: "https://pmvstash.org",
        stash_id: "pmv-keep",
      });
      expect(result).toContainEqual({
        endpoint: "https://custom.org",
        stash_id: "custom-keep",
      });
      expect(result).toContainEqual({
        endpoint: "https://newbox.org",
        stash_id: "newbox-add",
      });
      // Should NOT contain old stashdb ID
      expect(result).not.toContainEqual({
        endpoint: "https://stashdb.org",
        stash_id: "stashdb-old",
      });
    });
  });
});
