# Vexxx: New Features & Improvements

We are proud to introduce a suite of powerful new features designed to streamline your workflow and enhance the viewing experience.

## 🎬 Virtual Scenes (Segments)
**Turn one video into many scenes—seamlessly.**

*   **Virtual Timeline Technology**:
    *   The player now natively understands "Segments". When playing a segment, the timeline, scrubber, and duration reflect *only* that segment.
    *   **Sliced Assets**: Scrubber preview sprites are automatically filtered and time-shifted, so you see exactly what you're scrubbing.
    *   **Smart Constraints**: Keyboard shortcuts and playback controls are locked to the segment bounds, preventing accidental seeking outside the action.
*   **Zero-Copy Segments**: Create unlimited scenes from a single video file without duplicating data (Storage efficient!).
*   **Dedicated Management**: New "Segments" tab in the Scene Details view allows for rapid creation and tweaking of start/end points.

## 🏷️ Intelligent Auto-Identify
**Tagging just got smarter and faster.**

*   **One-Click Identification**: The "Run All" / "Mass Create" operations in the Scene Tagger now do double duty.
*   **Automatic Linking**: When creating missing Performers, Studios, or Tags from a StashBox scrape, WetFlix now automatically populates their **StashID**.
    *   *Result*: Created items are immediately "Blue Linked" and identified, eliminating the need for a second manual identification pass.
*   **Streamlined UI**: Cleaned up the "Bulk Operations" menu for a quicker, more intuitive tagging flow.

## 🕰️ Advanced Scheduled Tasks
**Automate your library maintenance with precision.**

*   **Flexible Scheduling**: Create unlimited custom tasks with granular Cron schedule support.
*   **Comprehensive Task Types**:
    *   **Scan Library**: Keep your content up-to-date automatically.
    *   **Generate Content**: Schedule thumbnail, sprite, and preview generation during off-hours.
    *   **Auto Tag**: Run your tagging rules periodically to catch new matches.
    *   **Clean & Optimize**: Automated database cleanup and optimization to keep WetFlix running fast.
    *   **Plugin System Integration**: Trigger specific tasks from your installed plugins on a schedule.
*   **Dashboard Control**: Manually trigger tasks, toggle schedules, and view "Next Run" times from a unified dashboard.

## � System Resource Monitor
**Real-time insight into your server's health.**

*   **Live Metrics**: The Task Dashboard now features a live Resource Monitor displaying:
    *   **Memory Usage**: Track real-time RAM consumption.
    *   **Concurrency Load**: Monitor active Goroutines to see how hard WetFlix is working.
*   **Parallel Processing**:
    *   **Multi-Tasking**: WetFlix now supports running up to **3 concurrent background tasks** simultaneously, significantly speeding up large library scans and generation queues.

## �💅 Polish & Refinements
*   **Player UX**: Hidden redundant time displays during segment playback to reduce confusion.
*   **Layout Fixes**: Resolved layout shifts in the Scene Player for a rock-solid viewing experience.
*   **Backend Optimization**: Removed restrictions on file assignment to enable the advanced "Group Scenes" architecture.

## 🎨 Aesthetic Overhaul
**A stunning new look for your library.**

*   **Cinematic Hero Banners**: The front page now features a Netflix-style video hero banner.
    *   **Autoplay Previews**: Immediately preview random scenes with muted autoplay.
    *   **Immersive Design**: Full-width visuals, gradient overlays, and studio logo integration.
*   **3D Carousels**: Browsing Groups and Performers is now an experience.
    *   **Cover Flow Interaction**: Smooth 3D perspective carousels that bring your content to the forefront.
    *   **Dynamic Styling**: Active items pop with scale and brightness effects, while background items fade gracefully.

## 🔍 Enhanced Discovery
*   **Global Tagger Search**: A new "Search All" capability in the Scene Tagger allows you to broadcast a single search query across all open scenes simultaneously.
    *   *Use Case*: Perfect for when you know a batch of scenes all belong to the same studio or performer but the file names are messy.
