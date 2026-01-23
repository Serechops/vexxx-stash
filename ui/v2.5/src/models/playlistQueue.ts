import * as GQL from "src/core/generated-graphql";

export type PlaylistMediaType = "SCENE" | "IMAGE" | "GALLERY" | "GROUP";

/**
 * Represents an item in the playlist queue.
 * For Groups, this will be expanded into individual scenes during playback.
 */
export interface PlaylistQueueItem {
  id: string;
  mediaType: PlaylistMediaType;
  mediaId: string;
  title?: string | null;
  thumbnailPath?: string | null;
  duration?: number | null;
  position: number;
  // For groups, store the original group info and expanded scenes
  groupScenes?: ExpandedGroupScene[];
}

/**
 * Represents a scene that belongs to a group, used when expanding groups for playback.
 */
export interface ExpandedGroupScene {
  sceneId: string;
  sceneIndex?: number | null;
  title?: string | null;
  thumbnailPath?: string | null;
  duration?: number | null;
}

/**
 * Represents a flattened playback item - the actual item being played.
 * Groups are expanded into their individual scenes.
 */
export interface PlaybackItem {
  type: "scene" | "image" | "gallery";
  id: string;
  title?: string | null;
  thumbnailPath?: string | null;
  duration?: number | null;
  // Reference to original playlist item
  originalItemId: string;
  originalItemType: PlaylistMediaType;
  // For scenes from groups
  groupId?: string;
  sceneIndex?: number | null;
}

/**
 * PlaylistQueue manages the playback queue for a playlist.
 * It handles expanding groups into their constituent scenes
 * and provides navigation between items.
 */
export class PlaylistQueue {
  public playlistId: string;
  public items: PlaylistQueueItem[] = [];
  private flattenedItems: PlaybackItem[] = [];
  private currentIndex: number = 0;

  constructor(playlistId: string) {
    this.playlistId = playlistId;
  }

  /**
   * Create a PlaylistQueue from playlist items data
   */
  public static fromPlaylistItems(
    playlistId: string,
    items: GQL.PlaylistItemDataFragment[]
  ): PlaylistQueue {
    const queue = new PlaylistQueue(playlistId);

    queue.items = items.map((item) => {
      // Get media ID from the nested object based on media type
      let mediaId = "";
      if (item.scene) {
        mediaId = item.scene.id;
      } else if (item.image) {
        mediaId = item.image.id;
      } else if (item.gallery) {
        mediaId = item.gallery.id;
      } else if (item.group) {
        mediaId = item.group.id;
      }

      return {
        id: item.id,
        mediaType: item.media_type as PlaylistMediaType,
        mediaId,
        title: item.title,
        thumbnailPath: item.thumbnail_path,
        duration: item.effective_duration,
        position: item.position,
      };
    });

    return queue;
  }

  /**
   * Set expanded scene data for group items
   */
  public setGroupScenes(
    groupId: string,
    scenes: ExpandedGroupScene[]
  ): void {
    const groupItem = this.items.find(
      (item) => item.mediaType === "GROUP" && item.mediaId === groupId
    );
    if (groupItem) {
      groupItem.groupScenes = scenes;
      this.rebuildFlattenedItems();
    }
  }

  /**
   * Rebuild the flattened items list after group expansion
   */
  private rebuildFlattenedItems(): void {
    this.flattenedItems = [];

    for (const item of this.items) {
      if (item.mediaType === "GROUP") {
        // Expand group into its scenes
        if (item.groupScenes && item.groupScenes.length > 0) {
          for (const scene of item.groupScenes) {
            this.flattenedItems.push({
              type: "scene",
              id: scene.sceneId,
              title: scene.title,
              thumbnailPath: scene.thumbnailPath,
              duration: scene.duration,
              originalItemId: item.id,
              originalItemType: "GROUP",
              groupId: item.mediaId,
              sceneIndex: scene.sceneIndex,
            });
          }
        }
      } else if (item.mediaType === "SCENE") {
        this.flattenedItems.push({
          type: "scene",
          id: item.mediaId,
          title: item.title,
          thumbnailPath: item.thumbnailPath,
          duration: item.duration,
          originalItemId: item.id,
          originalItemType: "SCENE",
        });
      } else if (item.mediaType === "IMAGE") {
        this.flattenedItems.push({
          type: "image",
          id: item.mediaId,
          title: item.title,
          thumbnailPath: item.thumbnailPath,
          duration: item.duration,
          originalItemId: item.id,
          originalItemType: "IMAGE",
        });
      } else if (item.mediaType === "GALLERY") {
        this.flattenedItems.push({
          type: "gallery",
          id: item.mediaId,
          title: item.title,
          thumbnailPath: item.thumbnailPath,
          duration: item.duration,
          originalItemId: item.id,
          originalItemType: "GALLERY",
        });
      }
    }
  }

  /**
   * Initialize flattened items (call after all groups are expanded)
   */
  public initialize(): void {
    this.rebuildFlattenedItems();
  }

  /**
   * Get all groups that need their scenes fetched
   */
  public getGroupIds(): string[] {
    return this.items
      .filter((item) => item.mediaType === "GROUP")
      .map((item) => item.mediaId);
  }

  /**
   * Get the flattened playback items
   */
  public getPlaybackItems(): PlaybackItem[] {
    return this.flattenedItems;
  }

  /**
   * Get current playback item
   */
  public getCurrentItem(): PlaybackItem | null {
    return this.flattenedItems[this.currentIndex] ?? null;
  }

  /**
   * Get current index
   */
  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Set current index
   */
  public setCurrentIndex(index: number): void {
    if (index >= 0 && index < this.flattenedItems.length) {
      this.currentIndex = index;
    }
  }

  /**
   * Go to specific playback item by id and type
   */
  public goToItem(id: string, type: "scene" | "image" | "gallery"): boolean {
    const index = this.flattenedItems.findIndex(
      (item) => item.id === id && item.type === type
    );
    if (index !== -1) {
      this.currentIndex = index;
      return true;
    }
    return false;
  }

  /**
   * Get next item
   */
  public next(): PlaybackItem | null {
    if (this.currentIndex < this.flattenedItems.length - 1) {
      this.currentIndex++;
      return this.getCurrentItem();
    }
    return null;
  }

  /**
   * Get previous item
   */
  public previous(): PlaybackItem | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.getCurrentItem();
    }
    return null;
  }

  /**
   * Check if there's a next item
   */
  public hasNext(): boolean {
    return this.currentIndex < this.flattenedItems.length - 1;
  }

  /**
   * Check if there's a previous item
   */
  public hasPrevious(): boolean {
    return this.currentIndex > 0;
  }

  /**
   * Get total count of playback items
   */
  public getTotalCount(): number {
    return this.flattenedItems.length;
  }

  /**
   * Create a link to play a specific item in the playlist
   */
  public makeLink(itemIndex: number, options?: { autoplay?: boolean }): string {
    let url = `/playlists/${this.playlistId}/play?index=${itemIndex}`;
    if (options?.autoplay) {
      url += "&autoplay=true";
    }
    return url;
  }

  /**
   * Get items grouped by type for different viewers
   */
  public getItemsByType(): {
    scenes: PlaybackItem[];
    images: PlaybackItem[];
    galleries: PlaybackItem[];
  } {
    return {
      scenes: this.flattenedItems.filter((i) => i.type === "scene"),
      images: this.flattenedItems.filter((i) => i.type === "image"),
      galleries: this.flattenedItems.filter((i) => i.type === "gallery"),
    };
  }
}

export default PlaylistQueue;
