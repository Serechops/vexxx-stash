import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
    Container,
    Row,
    Col,
    Form,
    Button,
    Card,
    Badge,
    Spinner,
    Alert,
    InputGroup,
    ListGroup,
    Pagination,
    ButtonGroup,
} from "react-bootstrap";
import { GroupScrapeDialog } from "../Groups/GroupDetails/GroupScrapeDialog";
import { queryScrapeGroupURL } from "src/core/StashService";
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

import "./moviefy.scss";

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
    }>;
}

interface QueueItem {
    group: GQL.ScrapedGroup & { id?: string };
    scenes: SceneItem[];
}

export const MovieFy: React.FC = () => {
    const intl = useIntl();
    const Toast = useToast();

    // Database configuration
    const { data: configData, loading: configLoading, refetch: refetchConfig } = GQL.useMovieFyConfigQuery();
    const [configureMovieFy] = GQL.useConfigureMovieFyMutation();
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
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");
    const [excludeGrouped, setExcludeGrouped] = useState(false);
    const [selectedScenes, setSelectedScenes] = useState<SceneItem[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<{ id?: string; name: string; url?: string; front_image?: string } | null>(null);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [queueModalOpen, setQueueModalOpen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [scrapedGroup, setScrapedGroup] = useState<GQL.ScrapedGroup>();
    const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

    async function handlePreview(movie: GQL.MovieFyResult, e: React.MouseEvent) {
        e.stopPropagation();
        if (!movie.url) return;

        setPreviewLoadingId(movie.id);
        try {
            const result = await queryScrapeGroupURL(movie.url);
            if (result.data?.scrapeGroupURL) {
                setScrapedGroup(result.data.scrapeGroupURL);
            } else {
                setScrapedGroup({
                    name: movie.name,
                    front_image: movie.front_image,
                    urls: [movie.url],
                } as GQL.ScrapedGroup);
            }
        } catch (error) {
            console.error("Scrape failed", error);
            setScrapedGroup({
                name: movie.name,
                front_image: movie.front_image,
                urls: [movie.url],
            } as GQL.ScrapedGroup);
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
    const movieFyMovies = movieFyData?.searchMovieFyDatabase?.movies || [];
    const movieFyPagination = movieFyData?.searchMovieFyDatabase?.pagination;
    const movieFyMode = movieFyData?.searchMovieFyDatabase?.mode || "basic";

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

    // Group selection
    // Group selection
    const handleGroupSelect = useCallback(
        (group: { id: string; name: string; url?: string; front_image?: string }) => {
            setSelectedGroup((prev) => (prev?.id === group.id && group.id !== "" ? null : group));
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

        const queueItem: QueueItem = {
            group: {
                ...groupToUse,
                urls: groupToUse.url ? [groupToUse.url] : undefined,
            },
            scenes: selectedScenes,
        };

        setQueue((prev) => [...prev, queueItem]);
        setSelectedGroup(null);
        setSelectedScenes([]);
        Toast.success("Added to queue");
    }, [selectedGroup, selectedScenes, Toast]);

    const handleMovieFyQueue = useCallback((scrapedGroup: GQL.ScrapedGroup) => {
        if (selectedScenes.length === 0) {
            Toast.error("Please select scenes to associate with this movie");
            return;
        }

        const queueItem: QueueItem = {
            group: scrapedGroup,
            scenes: selectedScenes,
        };

        setQueue((prev) => [...prev, queueItem]);
        setScrapedGroup(undefined);
        setSelectedScenes([]); // Clear scene selection? Probably yes.
        Toast.success(`Added "${scrapedGroup.name}" to queue with ${selectedScenes.length} scenes`);
    }, [selectedScenes, Toast]);

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
        <Container fluid className="moviefy-container">
            {/* Header */}
            <div className="moviefy-header text-center py-4">
                <h1 className="moviefy-title">
                    <Icon icon={faLayerGroup} className="mr-2" />
                    MovieFy
                    <Button
                        variant="link"
                        className="ml-2 text-muted"
                        onClick={() => setShowConfig(!showConfig)}
                    >
                        <Icon icon={faCog} />
                    </Button>
                </h1>
                <p className="text-muted">Organize scenes into groups</p>
            </div>

            {/* Search Bar */}
            <Row className="justify-content-center mb-4">
                <Col xs={12} md={8} lg={6}>
                    <InputGroup size="lg">
                        <InputGroup.Prepend>
                            <InputGroup.Text>
                                <Icon icon={faSearch} />
                            </InputGroup.Text>
                        </InputGroup.Prepend>
                        <Form.Control
                            type="text"
                            placeholder="Search scenes by folder or title..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <InputGroup.Append>
                                <Button variant="outline-secondary" onClick={handleClearSearch}>
                                    <Icon icon={faTimes} />
                                </Button>
                            </InputGroup.Append>
                        )}
                    </InputGroup>
                </Col>
            </Row>

            {/* Controls Row */}
            <Row className="mb-4 align-items-center">
                <Col xs="auto">
                    <ButtonGroup>
                        <Button
                            variant={viewMode === "list" ? "secondary" : "outline-secondary"}
                            onClick={() => setViewMode("list")}
                        >
                            <Icon icon={faList} />
                        </Button>
                        <Button
                            variant={viewMode === "grid" ? "secondary" : "outline-secondary"}
                            onClick={() => setViewMode("grid")}
                        >
                            <Icon icon={faThLarge} />
                        </Button>
                    </ButtonGroup>
                </Col>
                <Col xs="auto">
                    <Form.Check
                        type="switch"
                        id="exclude-grouped"
                        label="Exclude scenes with groups"
                        checked={excludeGrouped}
                        onChange={(e) => setExcludeGrouped(e.target.checked)}
                    />
                </Col>
                <Col xs="auto" className="ml-auto">
                    <Button variant="primary" onClick={() => setSidebarOpen(!sidebarOpen)}>
                        Queue <Badge variant="light">{queue.length}</Badge>
                    </Button>
                </Col>
            </Row>

            <Row>
                {/* Scenes Column */}
                <Col md={sidebarOpen ? 4 : 6}>
                    <Card className="moviefy-card">
                        <Card.Header className="d-flex justify-content-between align-items-center">
                            <span>
                                <Icon icon={faFilm} className="mr-2" />
                                Scenes ({filteredScenes.length})
                            </span>
                            {selectedScenes.length > 0 && (
                                <Badge variant="primary">{selectedScenes.length} selected</Badge>
                            )}
                        </Card.Header>
                        <Card.Body className="p-0 overflow-auto">
                            {scenesLoading ? (
                                <div className="text-center p-4">
                                    <Spinner animation="border" />
                                </div>
                            ) : paginatedScenes.length === 0 ? (
                                <div className="text-center text-muted p-4">
                                    {debouncedSearchTerm.length >= 2
                                        ? "No scenes found"
                                        : "Enter a search term (min 2 characters)"}
                                </div>
                            ) : viewMode === "list" ? (
                                <ListGroup variant="flush">
                                    {paginatedScenes.map((scene) => {
                                        const isSelected = selectedScenes.some((s) => s.id === scene.id);
                                        return (
                                            <ListGroup.Item
                                                key={scene.id}
                                                action
                                                active={isSelected}
                                                onClick={() => handleSceneSelect(scene)}
                                                className="d-flex align-items-center"
                                            >
                                                <img
                                                    src={scene.paths?.screenshot || ""}
                                                    alt=""
                                                    className="scene-thumbnail mr-3"
                                                    style={{ width: 100, height: 56, objectFit: "cover", borderRadius: 4 }}
                                                />
                                                <div className="flex-grow-1">
                                                    <div className="font-weight-bold">
                                                        {scene.title || scene.files?.[0]?.basename || "Untitled"}
                                                    </div>
                                                    <small className="text-muted">
                                                        <Icon icon={faFolder} className="mr-1" />
                                                        {scene.files?.[0]?.path
                                                            ? scene.files[0].path.split(/[/\\]/).slice(-2, -1)[0]
                                                            : "Segment / Virtual"}
                                                    </small>
                                                    {scene.groups && scene.groups.length > 0 && (
                                                        <div>
                                                            <small className="text-info">
                                                                <Icon icon={faLayerGroup} className="mr-1" />
                                                                {scene.groups.map((g) => g.group.name).join(", ")}
                                                            </small>
                                                        </div>
                                                    )}
                                                </div>
                                            </ListGroup.Item>
                                        );
                                    })}
                                </ListGroup>
                            ) : (
                                <Row noGutters className="p-3">
                                    {paginatedScenes.map((scene) => {
                                        const isSelected = selectedScenes.some((s) => s.id === scene.id);
                                        return (
                                            <Col key={scene.id} xs={6} md={4} className="p-1">
                                                <Card
                                                    className={`scene-card ${isSelected ? "selected" : ""}`}
                                                    onClick={() => handleSceneSelect(scene)}
                                                    style={{ cursor: "pointer" }}
                                                >
                                                    <div className="scene-card-image">
                                                        <img
                                                            src={scene.paths?.screenshot || ""}
                                                            alt=""
                                                            className="w-100"
                                                            style={{ aspectRatio: "16/9", objectFit: "cover" }}
                                                        />
                                                    </div>
                                                    <Card.Body className="p-2">
                                                        <small className="text-truncate d-block">
                                                            {scene.files?.[0]?.basename || scene.title}
                                                        </small>
                                                    </Card.Body>
                                                </Card>
                                            </Col>
                                        );
                                    })}
                                </Row>
                            )}
                        </Card.Body>
                        {totalPages > 1 && (
                            <Card.Footer className="d-flex justify-content-center">
                                <Pagination size="sm" className="mb-0">
                                    <Pagination.First onClick={() => setPage(1)} disabled={page === 1} />
                                    <Pagination.Prev onClick={() => setPage(page - 1)} disabled={page === 1} />
                                    <Pagination.Item active>{page}</Pagination.Item>
                                    <Pagination.Next onClick={() => setPage(page + 1)} disabled={page === totalPages} />
                                    <Pagination.Last onClick={() => setPage(totalPages)} disabled={page === totalPages} />
                                </Pagination>
                            </Card.Footer>
                        )}
                    </Card>
                </Col>

                {/* Groups Column */}
                <Col md={sidebarOpen ? 4 : 6}>
                    <Card className="moviefy-card">
                        <Card.Header>
                            <Icon icon={faDatabase} className="mr-2" />
                            Database ({movieFyMovies.length})
                        </Card.Header>
                        <div className="d-flex flex-column flex-grow-1 overflow-hidden">
                            <div className="flex-shrink-0">
                                {/* Config Alert */}
                                {showConfig && (
                                    <Alert variant="info" className="m-3">
                                        <h6>Configure MovieFy Database</h6>
                                        <p className="small mb-2">
                                            Please enter the absolute path to your <code>moviefy.db</code> file.
                                        </p>
                                        <InputGroup>
                                            <Form.Control
                                                value={dbPathInput}
                                                onChange={(e) => setDbPathInput(e.target.value)}
                                                placeholder="C:\Path\To\moviefy.db"
                                            />
                                            <InputGroup.Append>
                                                <Button variant="primary" onClick={handleConfigureDb}>
                                                    Save
                                                </Button>
                                            </InputGroup.Append>
                                        </InputGroup>
                                    </Alert>
                                )}

                                {/* DB Search Input */}
                                <div className="p-3 border-bottom">
                                    <InputGroup>
                                        <InputGroup.Prepend>
                                            <InputGroup.Text>
                                                <Icon icon={faSearch} />
                                            </InputGroup.Text>
                                        </InputGroup.Prepend>
                                        <Form.Control
                                            placeholder="Search MovieFy Database..."
                                            value={movieSearchTerm}
                                            onChange={(e) => setMovieSearchTerm(e.target.value)}
                                        />
                                    </InputGroup>
                                </div>
                            </div>

                            {/* DB Results */}
                            <Card.Body className="p-0 overflow-auto flex-grow-1">
                                {movieFyLoading ? (
                                    <div className="text-center p-4">
                                        <Spinner animation="border" />
                                    </div>
                                ) : movieFyMovies.length === 0 ? (
                                    <div className="text-center text-muted p-4">
                                        {movieSearchTerm.length < 2
                                            ? "Enter search term to find movies in database"
                                            : "No movies found in database"}
                                    </div>
                                ) : (
                                    <ListGroup variant="flush">
                                        {movieFyMovies.map((movie) => {
                                            const isSelected = selectedGroup?.url === movie.url;
                                            return (
                                                <ListGroup.Item
                                                    key={movie.id}
                                                    action
                                                    active={isSelected}
                                                    onClick={() =>
                                                        handleGroupSelect({
                                                            id: "",
                                                            name: movie.name,
                                                            url: movie.url || undefined,
                                                            front_image: movie.front_image || undefined,
                                                        })
                                                    }
                                                    className="movie-result d-flex align-items-center"
                                                >
                                                    <img
                                                        src={movie.front_image || ""}
                                                        alt=""
                                                        className="mr-3"
                                                        style={{
                                                            width: 50,
                                                            height: 70,
                                                            objectFit: "cover",
                                                            borderRadius: 4,
                                                            backgroundColor: "#333",
                                                        }}
                                                    />
                                                    <div className="flex-grow-1">
                                                        <div className="font-weight-bold">{movie.name}</div>
                                                        {movie.studio_name && (
                                                            <small className="text-muted">{movie.studio_name}</small>
                                                        )}
                                                        {movie.domain && (
                                                            <small className="text-muted d-block">{movie.domain}</small>
                                                        )}
                                                    </div>
                                                    {movie.url && (
                                                        <Button
                                                            variant="link"
                                                            className="ml-2 p-0 text-muted"
                                                            onClick={(e) => handlePreview(movie, e)}
                                                            title="Preview & Scrape"
                                                        >
                                                            {previewLoadingId === movie.id ? (
                                                                <Spinner animation="border" size="sm" />
                                                            ) : (
                                                                <Icon icon={faSearch} />
                                                            )}
                                                        </Button>
                                                    )}
                                                </ListGroup.Item>
                                            );
                                        })}
                                    </ListGroup>
                                )}
                            </Card.Body>
                        </div>
                    </Card>

                    {/* Action Buttons */}
                    <div className="d-flex mt-3" style={{ gap: "0.5rem" }}>
                        <Button
                            variant="secondary"
                            onClick={handleAddToQueue}
                            disabled={!selectedGroup || selectedScenes.length === 0}
                        >
                            <Icon icon={faPlus} className="mr-1" /> Add to Queue
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleProcessNow}
                            disabled={!selectedGroup || selectedScenes.length === 0 || processing}
                        >
                            {processing ? (
                                <>
                                    <Spinner animation="border" size="sm" className="mr-1" /> Processing...
                                </>
                            ) : (
                                <>
                                    <Icon icon={faPlay} className="mr-1" /> Process Now
                                </>
                            )}
                        </Button>
                    </div>
                </Col>

                {/* Queue Sidebar */}
                {sidebarOpen && (
                    <Col md={4}>
                        <Card className="moviefy-card">
                            <Card.Header className="d-flex justify-content-between align-items-center">
                                <span>Queue ({queue.length})</span>
                                <Button variant="link" size="sm" onClick={() => setSidebarOpen(false)}>
                                    <Icon icon={faTimes} />
                                </Button>
                            </Card.Header>
                            <Card.Body className="p-0 overflow-auto">
                                <div className="p-3 border-bottom d-flex" style={{ gap: "0.5rem" }}>
                                    <Button
                                        variant="outline-primary"
                                        size="sm"
                                        onClick={() => setQueueModalOpen(true)}
                                        disabled={queue.length === 0}
                                    >
                                        Review
                                    </Button>
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={processBatch}
                                        disabled={queue.length === 0 || processing}
                                    >
                                        {processing ? "Processing..." : "Process All"}
                                    </Button>
                                </div>

                                {queue.length === 0 ? (
                                    <p className="text-muted p-3 m-0">No items in queue</p>
                                ) : (
                                    <ListGroup variant="flush">
                                        {queue.map((item, index) => (
                                            <ListGroup.Item
                                                key={index}
                                                className="d-flex justify-content-between align-items-center"
                                            >
                                                <div>
                                                    <div className="font-weight-bold">{item.group.name}</div>
                                                    <small className="text-muted">{item.scenes.length} scenes</small>
                                                </div>
                                                <Button
                                                    variant="outline-danger"
                                                    size="sm"
                                                    onClick={() => removeFromQueue(index)}
                                                >
                                                    <Icon icon={faTimes} />
                                                </Button>
                                            </ListGroup.Item>
                                        ))}
                                    </ListGroup>
                                )}
                            </Card.Body>
                        </Card>
                    </Col>
                )}
            </Row>

            {/* Queue Modal */}
            <MovieFyQueue
                open={queueModalOpen}
                onClose={() => setQueueModalOpen(false)}
                queue={queue}
                onRemove={removeFromQueue}
                onProcess={processBatch}
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
                        setScrapedGroup(undefined);
                    }}
                />
            )}
        </Container>
    );
};

export default MovieFy;
