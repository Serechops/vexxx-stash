import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
    Box,
    Grid,
    Button,
    Card,
    CardHeader,
    CardContent,
    CardActions,
    Chip,
    CircularProgress,
    Alert,
    TextField,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    ListItemAvatar,
    Pagination,
    ButtonGroup,
    Typography,
    InputAdornment,
    IconButton,
    FormControlLabel,
    Switch,
    Stack,
    Divider,
    Paper
} from "@mui/material";
import { GroupScrapeDialog } from "../Groups/GroupDetails/GroupScrapeDialog";
import { queryScrapeGroupURL, queryScrapeSceneURL } from "src/core/StashService";
import { MovieFySceneURLMatcher } from "./MovieFySceneURLMatcher";
import { useIntl } from "react-intl";
import { Icon } from "../Shared/Icon";
import {
    faSearch,
    faFolder,
    faList,
    faThLarge,
    faPlus,
    faTimes,
    faPlay,
    faLayerGroup,
    faFilm,
    faCog,
    faDatabase,
} from "@fortawesome/free-solid-svg-icons";
import { debounce } from "lodash-es";

import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";
import { MovieFyQueue } from "./MovieFyQueue";
import { MovieFyFileBrowser } from "./MovieFyFileBrowser";

// Types for internal use
interface SceneItem {
    id: string;
    title?: string | null;
    paths: {
        screenshot?: string | null;
    };
    files: Array<{
        path: string;
        basename?: string;
    }>;
    groups?: Array<{
        group: { id: string; name: string };
        scene_index?: number;
    }>;
    new_scene_index?: number;
    studio?: { id: string } | null;
    tags?: Array<{ id: string }>;
    performers?: Array<{ id: string }>;
}

interface ClipEntry {
    url: string;
    scraped?: GQL.ScrapedScene | null;
}

interface QueueItem {
    group: GQL.ScrapedGroup & { id?: string };
    scenes: SceneItem[];
    propagateToScenes: boolean;
    sceneURLMap?: Record<string, string>; // sceneId → clip URL
    sceneClipData?: Record<string, GQL.ScrapedScene>; // sceneId → pre-scraped clip data
}

export const MovieFy: React.FC = () => {
    const intl = useIntl();
    const Toast = useToast();

    // Database configuration
    const { data: configData, loading: configLoading, refetch: refetchConfig } = GQL.useMovieFyConfigQuery();
    const [configureMovieFy] = GQL.useConfigureMovieFyMutation();
    const [addMovieFyEntry] = GQL.useAddMovieFyEntryMutation();
    const [dbPathInput, setDbPathInput] = useState("");
    const [showConfig, setShowConfig] = useState(false);

    // Initialize dbPathInput from config
    useEffect(() => {
        if (configData?.movieFyConfig?.database_path) {
            setDbPathInput(configData.movieFyConfig.database_path);
        }
    }, [configData]);

    // Scene search using Stash's native query
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
    const [movieSearchTerm, setMovieSearchTerm] = useState("");
    const [debouncedMovieSearchTerm, setDebouncedMovieSearchTerm] = useState("");

    // Debounced search
    useEffect(() => {
        const handler = debounce(() => {
            if (searchTerm.length >= 2) {
                setDebouncedSearchTerm(searchTerm);
            } else {
                setDebouncedSearchTerm("");
            }
        }, 500);
        handler();
        return () => handler.cancel();
    }, [searchTerm]);

    // Debounced movie search
    useEffect(() => {
        const handler = debounce(() => {
            if (movieSearchTerm.length >= 2) {
                setDebouncedMovieSearchTerm(movieSearchTerm);
            } else {
                setDebouncedMovieSearchTerm("");
            }
        }, 500);
        handler();
        return () => handler.cancel();
    }, [movieSearchTerm]);

    // Search moviefy.db using native GraphQL
    const [moviePage, setMoviePage] = useState(1);
    const { data: movieFyData, loading: movieFyLoading } = GQL.useSearchMovieFyDatabaseQuery({
        variables: {
            input: {
                search: debouncedMovieSearchTerm,
                page: moviePage,
                per_page: 40,
            },
        },
        skip: debouncedMovieSearchTerm.length < 2 || !configData?.movieFyConfig?.database_exists,
    });

    // Always restart MovieFy pagination from page 1 when the query changes.
    useEffect(() => {
        setMoviePage(1);
    }, [debouncedMovieSearchTerm]);

    // Find scenes using Stash's native GraphQL
    const { data: scenesData, loading: scenesLoading } = GQL.useFindScenesQuery({
        variables: {
            filter: {
                per_page: 100,
                q: debouncedSearchTerm || undefined,
            },
        },
        skip: debouncedSearchTerm.length < 2,
    });



    // Mutations using Stash's native GraphQL
    const [createGroup] = GQL.useGroupCreateMutation();
    const [updateScene] = GQL.useSceneUpdateMutation();

    // UI State
    const [manualUrl, setManualUrl] = useState("");
    const [isManualEntry, setIsManualEntry] = useState(false);
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");
    const [leftMode, setLeftMode] = useState<"search" | "browse">("search");
    const [excludeGrouped, setExcludeGrouped] = useState(false);
    const [selectedScenes, setSelectedScenes] = useState<SceneItem[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<{ id?: string; name: string; url?: string; front_image?: string } | null>(null);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [queueModalOpen, setQueueModalOpen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [scrapedGroup, setScrapedGroup] = useState<GQL.ScrapedGroup>();
    const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
    const [pendingClipData, setPendingClipData] = useState<ClipEntry[]>([]);
    const [clipsFetching, setClipsFetching] = useState(false);
    const [pendingQueueItem, setPendingQueueItem] = useState<Omit<QueueItem, "sceneURLMap" | "sceneClipData"> | null>(null);
    const [showURLMatcher, setShowURLMatcher] = useState(false);

    async function handleScrapeAndQueue(url: string, name: string, front_image?: string | null) {
        setPreviewLoadingId(url);
        try {
            const result = await queryScrapeGroupURL(url);
            if (result.data?.scrapeGroupURL) {
                const sg = result.data.scrapeGroupURL;
                const clipURLs = sg.scene_urls ?? [];
                if (clipURLs.length > 0) {
                    // Seed placeholders immediately so the matcher can open even before fetches resolve
                    setPendingClipData(clipURLs.map(u => ({ url: u })));
                    setClipsFetching(true);
                    // Pre-fetch all clip pages in parallel while user reviews the movie in GroupScrapeDialog
                    Promise.all(
                        clipURLs.map(async (u): Promise<ClipEntry> => {
                            try {
                                const r = await queryScrapeSceneURL(u);
                                return { url: u, scraped: r.data?.scrapeSceneURL ?? null };
                            } catch {
                                return { url: u, scraped: null };
                            }
                        })
                    ).then(results => {
                        setPendingClipData(results);
                        setClipsFetching(false);
                    });
                } else {
                    setPendingClipData([]);
                }
                setScrapedGroup(sg);
            } else {
                setPendingClipData([]);
                setScrapedGroup({ name, front_image: front_image ?? null, urls: [url] } as GQL.ScrapedGroup);
            }
        } catch {
            setPendingClipData([]);
            setScrapedGroup({ name, front_image: front_image ?? null, urls: [url] } as GQL.ScrapedGroup);
        } finally {
            setPreviewLoadingId(null);
        }
    }

    // Pagination
    const [page, setPage] = useState(1);
    const perPage = 40;

    // Handle database path configuration
    const handleConfigureDb = async () => {
        if (!dbPathInput.trim()) {
            Toast.error("Please enter a database path");
            return;
        }
        try {
            const { data } = await configureMovieFy({
                variables: { input: { database_path: dbPathInput.trim() } },
            });
            if (data?.configureMovieFy) {
                Toast.success("MovieFy database configured successfully");
                setShowConfig(false);
                refetchConfig();
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Failed to configure database";
            Toast.error(message);
        }
    };

    // MovieFy database results
    const movieFyMoviesRaw = movieFyData?.searchMovieFyDatabase?.movies || [];
    const movieFyPagination = movieFyData?.searchMovieFyDatabase?.pagination;
    const movieFyMode = movieFyData?.searchMovieFyDatabase?.mode || "basic";

    // Sort AdultEmpire results first
    const movieFyMovies = useMemo(() => {
        const isAE = (url?: string | null) =>
            !!url && (url.includes("adultempire.com") || url.includes("adultdvdempire.com"));
        return [...movieFyMoviesRaw].sort((a, b) => {
            const aAE = isAE(a.url) ? 0 : 1;
            const bAE = isAE(b.url) ? 0 : 1;
            return aAE - bAE;
        });
    }, [movieFyMoviesRaw]);

    // Keep page number in bounds when result count shrinks after a new search.
    useEffect(() => {
        if (!movieFyPagination) {
            return;
        }

        if (movieFyPagination.pages <= 0 && moviePage !== 1) {
            setMoviePage(1);
            return;
        }

        if (movieFyPagination.pages > 0 && moviePage > movieFyPagination.pages) {
            setMoviePage(movieFyPagination.pages);
        }
    }, [movieFyPagination, moviePage]);

    // Process scenes - group by folder
    const groupedScenes = useMemo(() => {
        const scenes = scenesData?.findScenes?.scenes || [];
        const result: Record<string, SceneItem[]> = {};

        scenes.forEach((scene) => {
            const filePath = scene.files?.[0]?.path;

            let folderName = "Uncategorized";
            if (filePath) {
                const pathParts = filePath.split(/[/\\]/);
                folderName = pathParts.slice(-2, -1)[0] || "Uncategorized";
            } else {
                folderName = "Segments / Virtual";
            }

            if (!result[folderName]) {
                result[folderName] = [];
            }

            result[folderName].push({
                id: scene.id,
                title: scene.title,
                paths: scene.paths,
                files: scene.files.map((f) => ({
                    path: f.path,
                    basename: f.path.split(/[/\\]/).pop() || f.path,
                })),
                groups: scene.groups?.map((g) => ({
                    group: { id: g.group.id, name: g.group.name },
                })),
                studio: scene.studio ? { id: scene.studio.id } : null,
                tags: scene.tags?.map((t) => ({ id: t.id })) ?? [],
                performers: scene.performers?.map((p) => ({ id: p.id })) ?? [],
            });
        });

        return result;
    }, [scenesData]);

    // Filter and paginate scenes
    const allScenes = useMemo(() => Object.values(groupedScenes).flat(), [groupedScenes]);

    const filteredScenes = useMemo(() => {
        let filtered = excludeGrouped
            ? allScenes.filter((scene) => !scene.groups || scene.groups.length === 0)
            : allScenes;

        // Exclude scenes already in queue
        const queuedSceneIds = new Set(queue.flatMap((item) => item.scenes.map((s) => s.id)));
        return filtered.filter((scene) => !queuedSceneIds.has(scene.id));
    }, [allScenes, excludeGrouped, queue]);

    const paginatedScenes = useMemo(() => {
        const start = (page - 1) * perPage;
        return filteredScenes.slice(start, start + perPage);
    }, [filteredScenes, page, perPage]);

    const totalPages = Math.ceil(filteredScenes.length / perPage);

    // Scene selection
    const handleSceneSelect = useCallback((scene: SceneItem) => {
        setSelectedScenes((prev) => {
            const exists = prev.some((s) => s.id === scene.id);
            return exists ? prev.filter((s) => s.id !== scene.id) : [...prev, scene];
        });
    }, []);

    // Bulk add/remove used by the folder-browser "select all in folder" action.
    const handleScenesBulk = useCallback((scenes: SceneItem[], select: boolean) => {
        setSelectedScenes((prev) => {
            if (select) {
                const have = new Set(prev.map((s) => s.id));
                return [...prev, ...scenes.filter((s) => !have.has(s.id))];
            }
            const remove = new Set(scenes.map((s) => s.id));
            return prev.filter((s) => !remove.has(s.id));
        });
    }, []);

    const selectedSceneIds = useMemo(
        () => new Set(selectedScenes.map((s) => s.id)),
        [selectedScenes]
    );

    // Group selection
    // Group selection
    const handleGroupSelect = useCallback(
        (group: { id: string; name: string; url?: string; front_image?: string }, manual = false) => {
            setSelectedGroup((prev) => (prev?.id === group.id && group.id !== "" ? null : group));
            setIsManualEntry(manual);
        },
        []
    );

    // Add to queue
    const handleAddToQueue = useCallback(() => {
        const groupToUse = selectedGroup;

        if (!groupToUse || selectedScenes.length === 0) {
            Toast.error("Please select both a group and scenes");
            return;
        }

        setQueue((prevQueue) => {
            const existingItemIndex = prevQueue.findIndex(item =>
                (groupToUse.id && item.group.id === groupToUse.id) ||
                item.group.name === groupToUse.name
            );

            if (existingItemIndex !== -1) {
                // Merge
                const newQueue = [...prevQueue];
                const existingItem = newQueue[existingItemIndex];
                const existingIds = new Set(existingItem.scenes.map(s => s.id));
                const nonDuplicates = selectedScenes.filter(s => !existingIds.has(s.id));

                if (nonDuplicates.length > 0) {
                    newQueue[existingItemIndex] = {
                        ...existingItem,
                        scenes: [...existingItem.scenes, ...nonDuplicates]
                    };
                    Toast.success(`Added ${nonDuplicates.length} scenes to existing group in queue`);
                } else {
                    Toast.success("Scenes already in queue for this group");
                }
                return newQueue;
            } else {
                const queueItem: QueueItem = {
                    group: {
                        ...groupToUse,
                        urls: groupToUse.url ? [groupToUse.url] : undefined,
                    },
                    scenes: selectedScenes,
                    propagateToScenes: false,
                };
                Toast.success("Added to queue");
                return [...prevQueue, queueItem];
            }
        });

        setSelectedGroup(null);
        setSelectedScenes([]);
    }, [selectedGroup, selectedScenes, Toast]);

    const handleMovieFyQueue = useCallback((scrapedGroup: GQL.ScrapedGroup, sceneIndex?: number) => {
        if (selectedScenes.length === 0) {
            Toast.error("Please select scenes to associate with this movie");
            return;
        }

        // Save to local moviefy.db if this came from a manually-entered URL
        if (isManualEntry && scrapedGroup.urls?.[0]) {
            addMovieFyEntry({
                variables: {
                    input: {
                        name: scrapedGroup.name ?? "",
                        url: scrapedGroup.urls[0],
                        front_image: scrapedGroup.front_image ?? undefined,
                        studio_name: scrapedGroup.studio?.name ?? undefined,
                    },
                },
            }).catch(() => {/* non-fatal — DB save is best-effort */});
            setIsManualEntry(false);
        }

        const scenesToAdd = selectedScenes.map((scene, i) => ({
            ...scene,
            new_scene_index: sceneIndex !== undefined ? sceneIndex + i : undefined,
        }));

        // When the scrape returned clip URLs, show the scene matcher before queuing
        if (pendingClipData.length > 0) {
            setPendingQueueItem({ group: scrapedGroup, scenes: scenesToAdd, propagateToScenes: true });
            setShowURLMatcher(true);
            setScrapedGroup(undefined);
            setSelectedScenes([]);
            return;
        }

        setQueue((prevQueue) => {
            const existingItemIndex = prevQueue.findIndex(item =>
                (item.group.urls && scrapedGroup.urls && item.group.urls[0] === scrapedGroup.urls[0]) ||
                item.group.name === scrapedGroup.name
            );

            if (existingItemIndex !== -1) {
                const newQueue = [...prevQueue];
                const existingItem = newQueue[existingItemIndex];
                const existingIds = new Set(existingItem.scenes.map(s => s.id));
                const nonDuplicates = scenesToAdd.filter(s => !existingIds.has(s.id));

                if (nonDuplicates.length > 0) {
                    newQueue[existingItemIndex] = {
                        ...existingItem,
                        scenes: [...existingItem.scenes, ...nonDuplicates],
                    };
                    Toast.success(`Added ${nonDuplicates.length} scenes to existing group in queue`);
                } else {
                    Toast.success("Scenes already in queue for this group");
                }
                return newQueue;
            } else {
                const queueItem: QueueItem = {
                    group: scrapedGroup,
                    scenes: scenesToAdd,
                    propagateToScenes: true,
                };
                Toast.success(`Added "${scrapedGroup.name}" to queue with ${scenesToAdd.length} scenes`);
                return [...prevQueue, queueItem];
            }
        });

        setScrapedGroup(undefined);
        setSelectedScenes([]);
    }, [selectedScenes, pendingClipData, Toast]);

    const handleURLMatcherConfirm = useCallback((sceneURLMap: Record<string, string>, sceneClipData: Record<string, GQL.ScrapedScene>) => {
        if (!pendingQueueItem) return;

        // Build 1-based clip position from the ordered pendingClipData array
        const clipOrder: Record<string, number> = {};
        pendingClipData.forEach((clip, i) => { clipOrder[clip.url] = i + 1; });

        // Auto-fill new_scene_index for matched scenes based on clip order
        const scenesWithIndex = pendingQueueItem.scenes.map(scene => {
            const clipURL = sceneURLMap[scene.id];
            return clipURL && clipOrder[clipURL] !== undefined
                ? { ...scene, new_scene_index: clipOrder[clipURL] }
                : scene;
        });

        setQueue(prev => [...prev, { ...pendingQueueItem, scenes: scenesWithIndex, sceneURLMap, sceneClipData }]);
        Toast.success(`Added "${pendingQueueItem.group.name}" to queue with ${Object.keys(sceneURLMap).length} scene clip matches`);
        setPendingQueueItem(null);
        setPendingClipData([]);
        setClipsFetching(false);
        setShowURLMatcher(false);
    }, [pendingQueueItem, pendingClipData, Toast]);

    const handleURLMatcherSkip = useCallback(() => {
        if (!pendingQueueItem) return;
        setQueue(prev => [...prev, pendingQueueItem]);
        Toast.success(`Added "${pendingQueueItem.group.name}" to queue`);
        setPendingQueueItem(null);
        setPendingClipData([]);
        setClipsFetching(false);
        setShowURLMatcher(false);
    }, [pendingQueueItem, Toast]);

    // Process single item immediately
    const handleProcessNow = useCallback(async () => {
        const groupToUse = selectedGroup;

        if (!groupToUse || selectedScenes.length === 0) {
            Toast.error("Please select both a group and scenes");
            return;
        }

        setProcessing(true);
        try {
            let groupId = groupToUse.id;

            // Create group if it doesn't exist
            if (!groupId) {
                const { data } = await createGroup({
                    variables: {
                        input: {
                            name: groupToUse.name,
                        },
                    },
                });
                groupId = data?.groupCreate?.id;
            }

            if (!groupId) throw new Error("Failed to create or find group");

            // Update each scene to associate with the group
            for (const scene of selectedScenes) {
                // Get existing group associations
                const existingGroups = scene.groups?.map((g) => ({
                    group_id: g.group.id,
                })) || [];

                await updateScene({
                    variables: {
                        input: {
                            id: scene.id,
                            groups: [...existingGroups, { group_id: groupId }],
                        },
                    },
                });
            }

            Toast.success(`Associated ${selectedScenes.length} scenes with "${groupToUse.name}"`);
            setSelectedGroup(null);
            setSelectedScenes([]);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "An error occurred";
            Toast.error(message);
        } finally {
            setProcessing(false);
        }
    }, [selectedGroup, selectedScenes, createGroup, updateScene, Toast]);

    // Process queue batch
    const processBatch = useCallback(async () => {
        setProcessing(true);
        try {
            for (const item of queue) {
                let groupId = item.group.id;

                // Create group if needed
                if (!groupId) {
                    const groupInput: GQL.GroupCreateInput = {
                        name: item.group.name || "Untitled Group",
                        aliases: item.group.aliases,
                        duration: item.group.duration ? parseInt(item.group.duration, 10) : undefined,
                        date: item.group.date,
                        director: item.group.director,
                        synopsis: item.group.synopsis,
                        studio_id: item.group.studio?.stored_id,
                        tag_ids: item.group.tags?.map(t => t.stored_id).filter(id => !!id) as string[],
                        urls: item.group.urls,
                        front_image: item.group.front_image,
                        back_image: item.group.back_image,
                    };

                    // Filter undefined values
                    const cleanInput = Object.fromEntries(
                        Object.entries(groupInput).filter(([_, v]) => v !== undefined)
                    ) as GQL.GroupCreateInput;

                    const { data } = await createGroup({
                        variables: {
                            input: cleanInput,
                        },
                    });
                    groupId = data?.groupCreate?.id;
                }

                if (!groupId) continue;

                // Update scenes
                for (const scene of item.scenes) {
                    const existingGroups = scene.groups?.map((g) => ({
                        group_id: g.group.id,
                        scene_index: g.scene_index,
                    })) || [];

                    const newGroupAssoc: { group_id: string; scene_index?: number } = {
                        group_id: groupId
                    };
                    if (scene.new_scene_index !== undefined) {
                        newGroupAssoc.scene_index = scene.new_scene_index;
                    }

                    const sceneInput: GQL.SceneUpdateInput = {
                        id: scene.id,
                        groups: [...existingGroups, newGroupAssoc],
                    };

                    if (item.propagateToScenes) {
                        const studioId = item.group.studio?.stored_id;
                        if (studioId) {
                            sceneInput.studio_id = studioId;
                        }

                        const movieTagIds = (item.group.tags ?? [])
                            .map((t) => t.stored_id)
                            .filter((id): id is string => !!id);
                        if (movieTagIds.length > 0) {
                            const existingTagIds = (scene.tags ?? []).map((t) => t.id);
                            sceneInput.tag_ids = [...new Set([...existingTagIds, ...movieTagIds])];
                        }
                    }

                    // Apply clip metadata — use pre-scraped data if available, otherwise fetch
                    const clipURL = item.sceneURLMap?.[scene.id];
                    let clipScraped: GQL.ScrapedScene | null | undefined = item.sceneClipData?.[scene.id];
                    if (!clipScraped && clipURL) {
                        try {
                            const clipResult = await queryScrapeSceneURL(clipURL);
                            clipScraped = clipResult.data?.scrapeSceneURL;
                        } catch (clipErr) {
                            console.warn(`Failed to scrape clip URL ${clipURL}:`, clipErr);
                        }
                    }
                    if (clipScraped) {
                        const matchedPerformerIds = (clipScraped.performers ?? [])
                            .map((p) => p.stored_id)
                            .filter((id): id is string => !!id);
                        if (matchedPerformerIds.length > 0) {
                            const existing = (scene.performers ?? []).map((p) => p.id);
                            sceneInput.performer_ids = [...new Set([...existing, ...matchedPerformerIds])];
                        }

                        const clipTagIds = (clipScraped.tags ?? [])
                            .map((t) => t.stored_id)
                            .filter((id): id is string => !!id);
                        if (clipTagIds.length > 0) {
                            const existing = sceneInput.tag_ids ?? (scene.tags ?? []).map((t) => t.id);
                            sceneInput.tag_ids = [...new Set([...existing, ...clipTagIds])];
                        }

                        if (clipScraped.image) sceneInput.cover_image = clipScraped.image;
                        if (clipScraped.date) sceneInput.date = clipScraped.date;
                        if (clipScraped.title && !scene.title) sceneInput.title = clipScraped.title;
                        if (clipScraped.details) sceneInput.details = clipScraped.details;

                        if (clipScraped.studio?.stored_id && !sceneInput.studio_id) {
                            sceneInput.studio_id = clipScraped.studio.stored_id;
                        }
                    }

                    await updateScene({
                        variables: { input: sceneInput },
                    });
                }
            }

            Toast.success("Queue processed successfully");
            setQueue([]);
        } catch (error: unknown) {
            console.error(error);
            const message = error instanceof Error ? error.message : "An error occurred";
            Toast.error(message);
        } finally {
            setProcessing(false);
        }
    }, [queue, createGroup, updateScene, Toast]);

    const removeFromQueue = useCallback((index: number) => {
        setQueue((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleClearSearch = () => {
        setSearchTerm("");
        setPage(1);
    };

    return (
        <Box sx={{ p: 3, minHeight: 'calc(100vh - 60px)' }}>
            {/* Header */}
            <Box textAlign="center" py={4} mb={2}>
                <Typography variant="h3" component="h1" gutterBottom sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon icon={faLayerGroup} className="mr-2" />
                    MovieFy
                    <IconButton
                        sx={{ ml: 2, color: 'text.secondary' }}
                        onClick={() => setShowConfig(!showConfig)}
                    >
                        <Icon icon={faCog} />
                    </IconButton>
                </Typography>
                <Typography variant="body1" color="textSecondary">Organize scenes into groups</Typography>
            </Box>

            {/* Search Bar */}
            <Grid container justifyContent="center" mb={4}>
                <Grid size={{ xs: 12, md: 8, lg: 6 }}>
                    <TextField
                        fullWidth
                        placeholder="Search scenes by folder or title..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Icon icon={faSearch} />
                                </InputAdornment>
                            ),
                            endAdornment: searchTerm && (
                                <InputAdornment position="end">
                                    <IconButton onClick={handleClearSearch} size="small">
                                        <Icon icon={faTimes} />
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                    />
                </Grid>
            </Grid>

            {/* Controls Row */}
            <Grid container alignItems="center" spacing={2} mb={4}>
                <Grid>
                    <ButtonGroup variant="outlined">
                        <Button
                            variant={viewMode === "list" ? "contained" : "outlined"}
                            onClick={() => setViewMode("list")}
                        >
                            <Icon icon={faList} />
                        </Button>
                        <Button
                            variant={viewMode === "grid" ? "contained" : "outlined"}
                            onClick={() => setViewMode("grid")}
                        >
                            <Icon icon={faThLarge} />
                        </Button>
                    </ButtonGroup>
                </Grid>
                <Grid>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={excludeGrouped}
                                onChange={(e) => setExcludeGrouped(e.target.checked)}
                            />
                        }
                        label="Exclude scenes with groups"
                    />
                </Grid>
                <Grid sx={{ ml: 'auto' }}>
                    <Button
                        variant="contained"
                        onClick={() => setQueueModalOpen(true)}
                        startIcon={<Icon icon={faList} />}
                    >
                        Review Queue
                        <Chip
                            label={queue.length}
                            size="small"
                            color="default"
                            sx={{ ml: 1, bgcolor: 'background.paper', color: 'text.primary' }}
                        />
                    </Button>
                </Grid>
            </Grid>

            <Grid container spacing={3}>
                {/* Scenes Column */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Card sx={{ height: 600, display: 'flex', flexDirection: 'column' }}>
                        <CardHeader
                            title={
                                <Box display="flex" alignItems="center">
                                    <Icon icon={faFilm} className="mr-2" />
                                    <Typography variant="h6">
                                        Scenes{leftMode === "search" ? ` (${filteredScenes.length})` : ""}
                                    </Typography>
                                    {selectedScenes.length > 0 && (
                                        <Chip label={`${selectedScenes.length} selected`} color="primary" sx={{ ml: 2 }} />
                                    )}
                                </Box>
                            }
                            action={
                                <ButtonGroup variant="outlined" size="small" sx={{ mt: 0.5 }}>
                                    <Button
                                        variant={leftMode === "search" ? "contained" : "outlined"}
                                        onClick={() => setLeftMode("search")}
                                        startIcon={<Icon icon={faSearch} />}
                                    >
                                        Search
                                    </Button>
                                    <Button
                                        variant={leftMode === "browse" ? "contained" : "outlined"}
                                        onClick={() => setLeftMode("browse")}
                                        startIcon={<Icon icon={faFolder} />}
                                    >
                                        Browse
                                    </Button>
                                </ButtonGroup>
                            }
                            sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
                        />
                        {selectedScenes.length > 0 && (
                            <Box sx={{ p: 1, bgcolor: 'action.selected', borderBottom: 1, borderColor: 'divider' }}>
                                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                    <Typography variant="caption">{selectedScenes.length} scenes parked</Typography>
                                    <Button size="small" onClick={() => setSelectedScenes([])}>Clear</Button>
                                </Box>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 100, overflowY: 'auto' }}>
                                    {selectedScenes.map(scene => (
                                        <Chip
                                            key={scene.id}
                                            label={scene.title || scene.files?.[0]?.basename || "Untitled"}
                                            onDelete={(e) => {
                                                e?.stopPropagation(); // Chip onDelete doesn't pass event in older MUI? In v5 it does. assume it does.
                                                handleSceneSelect(scene);
                                            }}
                                            onClick={() => { }} // prevent click propagation
                                            size="small"
                                            sx={{ maxWidth: 150 }}
                                        />
                                    ))}
                                </Box>
                            </Box>
                        )}
                        {leftMode === "browse" ? (
                            <MovieFyFileBrowser
                                selectedSceneIds={selectedSceneIds}
                                excludeGrouped={excludeGrouped}
                                onToggleScene={handleSceneSelect}
                                onBulkToggle={handleScenesBulk}
                            />
                        ) : (
                        <CardContent sx={{ p: 0, flexGrow: 1, overflowY: 'auto' }}>
                            {scenesLoading ? (
                                <Box display="flex" justifyContent="center" p={4}>
                                    <CircularProgress />
                                </Box>
                            ) : paginatedScenes.length === 0 ? (
                                <Box textAlign="center" p={4} color="text.secondary">
                                    {debouncedSearchTerm.length >= 2
                                        ? "No scenes found"
                                        : "Enter a search term (min 2 characters)"}
                                </Box>
                            ) : viewMode === "list" ? (
                                <List disablePadding>
                                    {paginatedScenes.map((scene) => {
                                        const isSelected = selectedScenes.some((s) => s.id === scene.id);
                                        return (
                                            <ListItemButton
                                                key={scene.id}
                                                selected={isSelected}
                                                onClick={() => handleSceneSelect(scene)}
                                                divider
                                            >
                                                <ListItemAvatar sx={{ mr: 2 }}>
                                                    <img
                                                        src={scene.paths?.screenshot || ""}
                                                        alt=""
                                                        style={{ width: 100, height: 56, objectFit: "cover", borderRadius: 4 }}
                                                    />
                                                </ListItemAvatar>
                                                <ListItemText
                                                    primary={scene.title || scene.files?.[0]?.basename || "Untitled"}
                                                    secondary={
                                                        <React.Fragment>
                                                            <Typography component="span" display="block" variant="caption" color="text.secondary">
                                                                <Icon icon={faFolder} className="mr-1" />
                                                                {scene.files?.[0]?.path
                                                                    ? scene.files[0].path.split(/[/\\]/).slice(-2, -1)[0]
                                                                    : "Segment / Virtual"}
                                                            </Typography>
                                                            {scene.groups && scene.groups.length > 0 && (
                                                                <Typography component="span" display="block" variant="caption" color="info.main">
                                                                    <Icon icon={faLayerGroup} className="mr-1" />
                                                                    {scene.groups.map((g) => g.group.name).join(", ")}
                                                                </Typography>
                                                            )}
                                                        </React.Fragment>
                                                    }
                                                />
                                            </ListItemButton>
                                        );
                                    })}
                                </List>
                            ) : (
                                <Grid container spacing={1} p={2}>
                                    {paginatedScenes.map((scene) => {
                                        const isSelected = selectedScenes.some((s) => s.id === scene.id);
                                        return (
                                            <Grid key={scene.id} size={{ xs: 6, md: 4 }}>
                                                <Card
                                                    onClick={() => handleSceneSelect(scene)}
                                                    sx={{
                                                        cursor: "pointer",
                                                        border: isSelected ? 2 : 1,
                                                        borderColor: isSelected ? 'primary.main' : 'divider',
                                                        height: '100%'
                                                    }}
                                                >
                                                    <Box sx={{ position: 'relative', pt: '56.25%' }}>
                                                        <img
                                                            src={scene.paths?.screenshot || ""}
                                                            alt=""
                                                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: "cover" }}
                                                        />
                                                    </Box>
                                                    <Box p={1}>
                                                        <Typography variant="caption" noWrap display="block">
                                                            {scene.files?.[0]?.basename || scene.title}
                                                        </Typography>
                                                    </Box>
                                                </Card>
                                            </Grid>
                                        );
                                    })}
                                </Grid>
                            )}
                        </CardContent>
                        )}
                        {leftMode === "search" && totalPages > 1 && (
                            <Box sx={{ p: 2, display: 'flex', justifyContent: 'center', borderTop: 1, borderColor: 'divider' }}>
                                <Pagination
                                    count={totalPages}
                                    page={page}
                                    onChange={(e, v) => setPage(v)}
                                    size="small"
                                    showFirstButton
                                    showLastButton
                                />
                            </Box>
                        )}
                    </Card>
                </Grid>

                {/* Groups Column */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Card sx={{ height: 600, display: 'flex', flexDirection: 'column' }}>
                        <CardHeader
                            title={
                                <Box display="flex" alignItems="center">
                                    <Icon icon={faDatabase} className="mr-2" />
                                    <Typography variant="h6">Database ({movieFyPagination?.total ?? movieFyMovies.length})</Typography>
                                </Box>
                            }
                            sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
                        />
                        <Box display="flex" flexDirection="column" flexGrow={1} overflow="hidden">
                            <Box flexShrink={0}>
                                {/* Config Alert */}
                                {showConfig && (
                                    <Alert severity="info" sx={{ m: 2 }}>
                                        <Typography variant="subtitle2" gutterBottom>Configure MovieFy Database</Typography>
                                        <Typography variant="caption" display="block" paragraph>
                                            Please enter the absolute path to your <code>moviefy.db</code> file.
                                        </Typography>
                                        <Box display="flex" gap={1}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                value={dbPathInput}
                                                onChange={(e) => setDbPathInput(e.target.value)}
                                                placeholder="C:\Path\To\moviefy.db"
                                            />
                                            <Button variant="contained" onClick={handleConfigureDb}>
                                                Save
                                            </Button>
                                        </Box>
                                    </Alert>
                                )}

                                {/* DB Search Input */}
                                <Box p={2} borderBottom={1} borderColor="divider">
                                    <TextField
                                        fullWidth
                                        size="small"
                                        placeholder="Search MovieFy Database..."
                                        value={movieSearchTerm}
                                        onChange={(e) => {
                                            setMovieSearchTerm(e.target.value);
                                            if (moviePage !== 1) {
                                                setMoviePage(1);
                                            }
                                        }}
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">
                                                    <Icon icon={faSearch} />
                                                </InputAdornment>
                                            ),
                                            endAdornment: movieSearchTerm ? (
                                                <InputAdornment position="end">
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => {
                                                            setMovieSearchTerm("");
                                                            setMoviePage(1);
                                                        }}
                                                    >
                                                        <Icon icon={faTimes} />
                                                    </IconButton>
                                                </InputAdornment>
                                            ) : undefined,
                                        }}
                                    />
                                    {debouncedMovieSearchTerm.length >= 2 && movieFyPagination && (
                                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                                            Showing {movieFyMovies.length} of {movieFyPagination.total} results • Page {movieFyPagination.page} of {movieFyPagination.pages}
                                        </Typography>
                                    )}
                                </Box>

                                {/* Manual URL entry */}
                                <Box px={2} pb={2} borderBottom={1} borderColor="divider">
                                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
                                        Or scrape directly from a URL
                                    </Typography>
                                    <Box display="flex" gap={1}>
                                        <TextField
                                            fullWidth
                                            size="small"
                                            placeholder="https://www.adultempire.com/…"
                                            value={manualUrl}
                                            onChange={(e) => setManualUrl(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && manualUrl.trim()) {
                                                    const url = manualUrl.trim();
                                                    try { new URL(url); } catch { return; }
                                                    handleGroupSelect({ id: "", name: new URL(url).hostname, url }, true);
                                                    setManualUrl("");
                                                }
                                            }}
                                        />
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            sx={{ flexShrink: 0 }}
                                            disabled={!manualUrl.trim()}
                                            onClick={() => {
                                                const url = manualUrl.trim();
                                                try { new URL(url); } catch { return; }
                                                handleGroupSelect({ id: "", name: new URL(url).hostname, url }, true);
                                                setManualUrl("");
                                            }}
                                        >
                                            Use
                                        </Button>
                                    </Box>
                                </Box>
                            </Box>

                            {/* DB Results */}
                            <CardContent sx={{ p: 0, flexGrow: 1, overflowY: 'auto' }}>
                                {movieFyLoading ? (
                                    <Box display="flex" justifyContent="center" p={4}>
                                        <CircularProgress />
                                    </Box>
                                ) : movieFyMovies.length === 0 ? (
                                    <Box textAlign="center" p={4} color="text.secondary">
                                        {movieSearchTerm.length < 2
                                            ? "Enter search term to find movies in database"
                                            : "No movies found in database"}
                                    </Box>
                                ) : (
                                    <List disablePadding>
                                        {movieFyMovies.map((movie) => {
                                            const isSelected = selectedGroup?.url === movie.url;
                                            return (
                                                <ListItemButton
                                                    key={movie.id}
                                                    selected={isSelected || previewLoadingId === movie.url}
                                                    disabled={!!previewLoadingId && previewLoadingId !== movie.url}
                                                    onClick={() => {
                                                        handleGroupSelect({
                                                            id: "",
                                                            name: movie.name,
                                                            url: movie.url || undefined,
                                                            front_image: movie.front_image || undefined,
                                                        });
                                                    }}
                                                    divider
                                                >
                                                    <ListItemAvatar sx={{ mr: 2, position: "relative", minWidth: "auto" }}>
                                                        <img
                                                            src={movie.front_image || ""}
                                                            alt=""
                                                            style={{
                                                                width: 90,
                                                                height: 126,
                                                                objectFit: "cover",
                                                                borderRadius: 4,
                                                                backgroundColor: "#333",
                                                                display: "block",
                                                            }}
                                                        />
                                                        {previewLoadingId === movie.url && (
                                                            <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "rgba(0,0,0,0.6)", borderRadius: "4px" }}>
                                                                <CircularProgress size={20} color="inherit" />
                                                            </Box>
                                                        )}
                                                    </ListItemAvatar>
                                                    <ListItemText
                                                        primary={<Typography variant="subtitle1" noWrap>{movie.name}</Typography>}
                                                        secondary={
                                                            <React.Fragment>
                                                                {movie.studio_name && (
                                                                    <Typography variant="caption" display="block" color="text.secondary">
                                                                        {movie.studio_name}
                                                                    </Typography>
                                                                )}
                                                                {movie.domain && (
                                                                    <Typography variant="caption" display="block" color="text.secondary">
                                                                        {movie.domain}
                                                                    </Typography>
                                                                )}
                                                            </React.Fragment>
                                                        }
                                                    />
                                                </ListItemButton>
                                            );
                                        })}
                                    </List>
                                )}
                            </CardContent>
                            {debouncedMovieSearchTerm.length >= 2 && (movieFyPagination?.pages ?? 0) > 1 && (
                                <Box sx={{ p: 2, display: 'flex', justifyContent: 'center', borderTop: 1, borderColor: 'divider' }}>
                                    <Pagination
                                        count={movieFyPagination?.pages ?? 1}
                                        page={moviePage}
                                        onChange={(e, v) => setMoviePage(v)}
                                        size="small"
                                        showFirstButton
                                        showLastButton
                                    />
                                </Box>
                            )}
                        </Box>
                    </Card>

                    {/* Action Buttons */}
                    <Box mt={2} display="flex" gap={2}>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() => {
                                if (selectedGroup?.url) {
                                    handleScrapeAndQueue(selectedGroup.url, selectedGroup.name, selectedGroup.front_image);
                                } else {
                                    handleAddToQueue();
                                }
                            }}
                            disabled={!selectedGroup || selectedScenes.length === 0 || !!previewLoadingId}
                            startIcon={
                                previewLoadingId
                                    ? <CircularProgress size={16} color="inherit" />
                                    : selectedGroup?.url
                                    ? <Icon icon={faSearch} />
                                    : <Icon icon={faPlus} />
                            }
                        >
                            {selectedGroup?.url ? "Scrape & Queue" : "Add to Queue"}
                        </Button>
                        <Button
                            variant="outlined"
                            color="inherit"
                            onClick={handleProcessNow}
                            disabled={!selectedGroup || selectedScenes.length === 0 || processing}
                            startIcon={!processing ? <Icon icon={faPlay} /> : undefined}
                        >
                            {processing ? (
                                <>
                                    <CircularProgress size={20} color="inherit" sx={{ mr: 1 }} /> Processing...
                                </>
                            ) : (
                                "Link Now"
                            )}
                        </Button>
                    </Box>
                </Grid>

                {/* Queue Sidebar - Replaced with Modal/Review Queue button for now, or could be a drawer */}
                {/* The original code had a conditional sidebar col. I'll stick to the modal approach which seems to be the primary 'Review Queue' action, 
                    but the original had a sidebar that could overlay? 
                    Actually, the original switched layout: Col md={4} appeared if sidebarOpen.
                    I'll skip the sidebar for now as the 'Review Queue' button opens the modal which is cleaner in MUI.
                */}
            </Grid>

            {/* Queue Modal */}
            <MovieFyQueue
                open={queueModalOpen}
                onClose={() => setQueueModalOpen(false)}
                queue={queue}
                onRemove={removeFromQueue}
                onProcess={processBatch}
                onUpdateQueue={setQueue}
                processing={processing}
            />
            {/* Scrape Dialog */}
            {scrapedGroup && (
                <GroupScrapeDialog
                    group={{}}
                    groupStudio={null}
                    groupTags={[]}
                    scraped={scrapedGroup}
                    onMovieFyQueue={handleMovieFyQueue}
                    onClose={(result) => {
                        if (result) {
                            setSelectedGroup({
                                id: "",
                                name: result.name ?? "",
                                url: result.urls?.[0] ?? undefined,
                                front_image: result.front_image ?? undefined,
                            });
                        }
                        setPendingClipData([]);
                        setClipsFetching(false);
                        setScrapedGroup(undefined);
                    }}
                />
            )}
            {/* Scene URL Matcher — shown after GroupScrapeDialog when clip URLs were found */}
            <MovieFySceneURLMatcher
                open={showURLMatcher}
                clipData={pendingClipData}
                clipsFetching={clipsFetching}
                scenes={pendingQueueItem?.scenes ?? []}
                onConfirm={handleURLMatcherConfirm}
                onSkip={handleURLMatcherSkip}
                onClose={() => {
                    setPendingQueueItem(null);
                    setPendingClipData([]);
                    setClipsFetching(false);
                    setShowURLMatcher(false);
                }}
            />
        </Box>
    );
};

export default MovieFy;
