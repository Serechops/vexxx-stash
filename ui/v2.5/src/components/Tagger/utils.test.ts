import { describe, it, expect } from "vitest";
import { parsePath } from "./utils";

describe("Tagger Utils", () => {
  describe("parsePath", () => {
    it("should return empty result for empty path", () => {
      const result = parsePath("");
      expect(result).toEqual({
        paths: [],
        file: "",
        ext: "",
      });
    });

    it("should parse simple Unix-style path", () => {
      const result = parsePath("/home/user/videos/scene.mp4");
      expect(result).toEqual({
        paths: ["home", "user", "videos"],
        file: "scene",
        ext: ".mp4",
      });
    });

    it("should parse Windows-style path with drive letter", () => {
      const result = parsePath("C:\\Videos\\Studio\\scene.mp4");
      expect(result).toEqual({
        paths: ["videos", "studio"],
        file: "scene",
        ext: ".mp4",
      });
    });

    it("should parse UNC path", () => {
      const result = parsePath("\\\\server\\share\\videos\\clip.mkv");
      expect(result).toEqual({
        paths: ["server", "share", "videos"],
        file: "clip",
        ext: ".mkv",
      });
    });

    it("should handle files with multiple dots in name", () => {
      const result = parsePath("/videos/scene.name.with.dots.mp4");
      expect(result).toEqual({
        paths: ["videos"],
        file: "scene.name.with.dots",
        ext: ".mp4",
      });
    });

    it("should handle files without extension", () => {
      const result = parsePath("/videos/scenename");
      expect(result.paths).toEqual(["videos"]);
      expect(result.ext).toBe("");
      expect(result.file).toBe("scenename");
    });

    it("should filter out . and .. path components", () => {
      const result = parsePath("/videos/../other/./scenes/clip.mp4");
      expect(result.paths).toEqual(["videos", "other", "scenes"]);
      expect(result.paths).not.toContain("..");
      expect(result.paths).not.toContain(".");
    });

    it("should handle deeply nested paths", () => {
      const result = parsePath(
        "/media/videos/sorted/studio/performer/year/scene.mp4"
      );
      expect(result).toEqual({
        paths: ["media", "videos", "sorted", "studio", "performer", "year"],
        file: "scene",
        ext: ".mp4",
      });
    });

    it("should handle file in root directory", () => {
      const result = parsePath("/video.mp4");
      expect(result).toEqual({
        paths: [],
        file: "video",
        ext: ".mp4",
      });
    });

    it("should lowercase all path components", () => {
      const result = parsePath("/Videos/STUDIO/Performer/Scene.MP4");
      expect(result).toEqual({
        paths: ["videos", "studio", "performer"],
        file: "scene",
        ext: ".mp4",
      });
    });

    it("should handle various video extensions", () => {
      expect(parsePath("/v/a.mkv").ext).toBe(".mkv");
      expect(parsePath("/v/a.avi").ext).toBe(".avi");
      expect(parsePath("/v/a.mov").ext).toBe(".mov");
      expect(parsePath("/v/a.wmv").ext).toBe(".wmv");
      expect(parsePath("/v/a.webm").ext).toBe(".webm");
    });
  });
});
