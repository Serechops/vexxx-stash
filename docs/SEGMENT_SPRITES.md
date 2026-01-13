# Segment Sprites and VTT Generation

This document outlines the implementation details for generating and displaying sprites for scene segments.

## Overview

Scene segments require unique handling for sprite generation compared to full scenes because:
1.  They share the same source file as the parent scene.
2.  They have specific Start and End points.
3.  Their timestamps in the VTT file must align with the segment's timeline (relative to the start point) or be correctly offset.

## Backend Implementation

### Unique File Hashes
To prevent segment sprites from overwriting the parent scene's sprites (or each other), the `Scene.GetHash` method has been modified.
- **Standard Scenes**: Uses `OSHash` or `Checksum`.
- **Segments**: Appends `_segment_[SceneID]` to the hash (e.g., `abc123_segment_45`).
- This ensures `generated/vtt` and `generated/sprites` contain distinct files for segments.

### Sprite Generation
The `GenerateSpriteTask` respects the scene's `StartPoint` and `EndPoint`.
- **StartOffset**: Passed to the generator to ensure ffmpeg captures frames starting from the correct time.
- **VTT Timestamps**: The generated VTT file contains absolute timestamps from the source video (e.g., `00:10:00.000`), allowing the frontend to map them correctly to the segment's timeline.

### Routing
A custom route handler `ServeSceneFile` has been added to `internal/api/routes_scene.go`.
- **Route**: `GET /scene/{file}`
- **Purpose**: Bypasses standard regex limitations in the router that struggled with underscores in segment hashes.
- **Logic**: Manually checks for `_thumbs.vtt` or `_sprite.jpg` suffixes to identify and serve the correct file.

## Frontend Implementation

### SegmentPlayer
The `SegmentPlayer` component uses the `ScenePlayerScrubber`.
- **Props**: Passes `start` and `end` props corresponding to the segment's boundaries in the source file.

### ScenePlayerScrubber
The scrubber filters sprites based on these bounds.
- **Filtering**: Sprites with timestamps outside the `start` -> `end` range are ignored.
- **Positioning**: Sprites are positioned relative to the `start` time, ensuring the scrubber timeline visually begins at 0:00 for the user, while internally mapping to the absolute video time.
