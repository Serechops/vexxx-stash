import React, { useState, useMemo } from "react";
import { Button, Form, InputGroup, Dropdown, DropdownButton, ButtonGroup } from "react-bootstrap";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { useConfigurationContext } from "src/hooks/Config";
import { Icon } from "src/components/Shared/Icon";
import { faPlus, faSearch, faSortAmountDown, faSortAmountUp, faFilter } from "@fortawesome/free-solid-svg-icons";
import { getClient } from "src/core/StashService";
import { ScrapedSceneCardsGrid } from "src/components/Scenes/ScrapedSceneCardsGrid";
import { Pagination } from "src/components/List/Pagination";

interface IPerformerMissingScenesPanelProps {
    active: boolean;
    performer: GQL.PerformerDataFragment;
}

type StatusFilter = "all" | "untracked" | "tracked" | "owned";
type SortField = "date" | "title" | "studio";
type SortDirection = "asc" | "desc";

export const PerformerMissingScenesPanel: React.FC<IPerformerMissingScenesPanelProps> = ({
    active,
    performer,
}) => {
    const intl = useIntl();
    const [scanning, setScanning] = useState(false);
    const [missingScenes, setMissingScenes] = useState<GQL.ScrapedSceneDataFragment[]>([]);
    const [trackedStatus, setTrackedStatus] = useState<Record<string, boolean>>({});
    const [ownedStatus, setOwnedStatus] = useState<Record<string, boolean>>({});
    const [trailerUrls, setTrailerUrls] = useState<Record<string, string>>({});
    const [trailersFetched, setTrailersFetched] = useState(false);
    const { configuration } = useConfigurationContext();
    const Toast = useToast();

    // Filter/Sort/Pagination state
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [sortField, setSortField] = useState<SortField>("date");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(24);

    // Create/Destroy hooks
    const [createPotentialScene] = GQL.usePotentialSceneCreateMutation();

    // Additional Filters
    const [selectedStudio, setSelectedStudio] = useState<string | null>(null);
    const [selectedPerformer, setSelectedPerformer] = useState<string | null>(null);
    const [selectedTag, setSelectedTag] = useState<string | null>(null);

    // Trailer scraping query (lazy)
    const [scrapeTrailers, { loading: scrapingTrailers }] = GQL.useScrapeTrailerUrlsLazyQuery();

    const stashBoxEndpoints = useMemo(() => {
        return configuration?.general.stashBoxes || [];
    }, [configuration]);

    // Potential Scenes Query
    const { data: potentialData, refetch: refetchPotential } = GQL.useFindPotentialScenesQuery({
        variables: {
            filter: {
                performer_stash_id: performer.stash_ids?.[0]?.stash_id
            }
        },
        skip: !performer.stash_ids || performer.stash_ids.length === 0,
        fetchPolicy: "network-only",
    });

    // Populate missingScenes, trackedStatus, and ownedStatus from potentialData on load
    React.useEffect(() => {
        if (potentialData?.findPotentialScenes) {
            const loadedScenes: GQL.ScrapedSceneDataFragment[] = [];
            const newTrackedStatus: Record<string, boolean> = {};
            const newOwnedStatus: Record<string, boolean> = {};

            potentialData.findPotentialScenes.forEach((ps) => {
                try {
                    const sceneData = JSON.parse(ps.data) as GQL.ScrapedSceneDataFragment;
                    loadedScenes.push(sceneData);
                    newTrackedStatus[ps.stash_id] = true;
                    if (ps.existing_scene?.id) {
                        newOwnedStatus[ps.stash_id] = true;
                    }
                } catch (e) {
                    console.error("Failed to parse potential scene data", e);
                }
            });

            if (Object.keys(newOwnedStatus).length > 0) {
                setOwnedStatus(prev => ({ ...prev, ...newOwnedStatus }));
            }
            if (Object.keys(newTrackedStatus).length > 0) {
                setTrackedStatus(prev => ({ ...prev, ...newTrackedStatus }));
            }

            // Merge loaded scenes with existing missing scenes to prevent overwriting scan results
            setMissingScenes(prev => {
                const existingIds = new Set(prev.map(s => s.remote_site_id));
                const combined = [...prev];
                let changed = false;

                loadedScenes.forEach(s => {
                    if (s.remote_site_id && !existingIds.has(s.remote_site_id)) {
                        combined.push(s);
                        changed = true;
                    }
                });

                return changed ? combined : prev;
            });
        }
    }, [potentialData]); // Remove scanning dependency to avoid race conditions

    // Fetch trailers when tab becomes active and scenes are loaded
    React.useEffect(() => {
        if (active && missingScenes.length > 0 && !trailersFetched && !scrapingTrailers) {
            // Collect URLs from scenes
            const urls = missingScenes
                .map(s => s.urls?.[0])
                .filter((url): url is string => !!url);

            if (urls.length > 0) {
                setTrailersFetched(true);
                scrapeTrailers({
                    variables: { urls },
                }).then((result) => {
                    if (result.data?.scrapeTrailerUrls) {
                        const newTrailerUrls: Record<string, string> = {};
                        result.data.scrapeTrailerUrls.forEach(t => {
                            if (t.trailer_url) {
                                newTrailerUrls[t.url] = t.trailer_url;
                            }
                        });
                        setTrailerUrls(newTrailerUrls);
                    }
                }).catch(err => {
                    console.error("Failed to scrape trailers:", err);
                });
            }
        }
    }, [active, missingScenes, trailersFetched, scrapingTrailers, scrapeTrailers]);

    // Extract unique values for filters
    const { uniqueStudios, uniquePerformers, uniqueTags } = useMemo(() => {
        const studios = new Map<string, string>();
        const performers = new Map<string, string>();
        const tags = new Map<string, string>();

        missingScenes.forEach(scene => {
            if (scene.studio?.name) {
                // Use name as ID for simplicity since scraped data might not have stable IDs
                studios.set(scene.studio.name, scene.studio.name);
            }
            scene.performers?.forEach(p => {
                if (p.name) performers.set(p.name, p.name);
            });
            scene.tags?.forEach(t => {
                if (t.name) tags.set(t.name, t.name);
            });
        });

        return {
            uniqueStudios: Array.from(studios.values()).sort(),
            uniquePerformers: Array.from(performers.values()).sort(),
            uniqueTags: Array.from(tags.values()).sort(),
        };
    }, [missingScenes]);

    // Filter, sort, and paginate scenes
    const filteredAndSortedScenes = useMemo(() => {
        let result = [...missingScenes];

        // Apply metadata filters
        if (selectedStudio) {
            result = result.filter(s => s.studio?.name === selectedStudio);
        }
        if (selectedPerformer) {
            result = result.filter(s => s.performers?.some(p => p.name === selectedPerformer));
        }
        if (selectedTag) {
            result = result.filter(s => s.tags?.some(t => t.name === selectedTag));
        }

        // Apply search filter
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            result = result.filter(s =>
                s.title?.toLowerCase().includes(term) ||
                s.studio?.name?.toLowerCase().includes(term) ||
                s.performers?.some(p => p.name?.toLowerCase().includes(term))
            );
        }

        // Apply status filter
        if (statusFilter !== "all") {
            result = result.filter(s => {
                const id = s.remote_site_id;
                if (!id) return false;
                const isOwned = ownedStatus[id];
                const isTracked = trackedStatus[id];

                switch (statusFilter) {
                    case "owned": return isOwned;
                    case "tracked": return isTracked && !isOwned;
                    case "untracked": return !isTracked;
                    default: return true;
                }
            });
        }

        // Apply sorting
        result.sort((a, b) => {
            let comparison = 0;
            switch (sortField) {
                case "date":
                    comparison = (a.date || "").localeCompare(b.date || "");
                    break;
                case "title":
                    comparison = (a.title || "").localeCompare(b.title || "");
                    break;
                case "studio":
                    comparison = (a.studio?.name || "").localeCompare(b.studio?.name || "");
                    break;
            }
            return sortDirection === "asc" ? comparison : -comparison;
        });

        return result;
    }, [missingScenes, searchTerm, statusFilter, sortField, sortDirection, trackedStatus, ownedStatus]);

    // Paginated results
    const paginatedScenes = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredAndSortedScenes.slice(start, start + itemsPerPage);
    }, [filteredAndSortedScenes, currentPage, itemsPerPage]);

    // Reset to page 1 when filters change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter, sortField, sortDirection, selectedStudio, selectedPerformer, selectedTag]);

    const [scrapePerformerScenes] = GQL.useScrapePerformerScenesFromStashBoxMutation();

    const onScan = async () => {
        if (!performer.stash_ids || performer.stash_ids.length === 0) {
            Toast.error("Performer has no StashBox IDs");
            return;
        }

        setScanning(true);
        setTrailersFetched(false); // Reset trailer fetching for new scan

        try {
            const allScraped: GQL.ScrapedSceneDataFragment[] = [...missingScenes]; // Keep existing
            const existingIds = new Set(allScraped.map(s => s.remote_site_id));
            let newScenesCount = 0;

            // For each stash_id, query the corresponding stash box endpoint
            for (const stashId of performer.stash_ids) {
                if (!stashId.stash_id || !stashId.endpoint) continue;

                try {
                    // Use the new mutation that fetches performer with all scenes
                    const result = await scrapePerformerScenes({
                        variables: {
                            stash_box_endpoint: stashId.endpoint,
                            performer_stash_id: stashId.stash_id,
                        },
                    });

                    const scrapedPerformer = result.data?.scrapePerformerScenesFromStashBox;
                    if (!scrapedPerformer) continue;

                    // Extract scenes from the performer data
                    const scenes = scrapedPerformer.scenes || [];

                    for (const scene of scenes) {
                        // Skip if we already have this scene
                        if (scene.remote_site_id && existingIds.has(scene.remote_site_id)) {
                            continue;
                        }

                        // Add to our list
                        allScraped.push(scene);
                        if (scene.remote_site_id) {
                            existingIds.add(scene.remote_site_id);
                        }
                        newScenesCount++;
                    }

                    Toast.success(`Found ${scenes.length} scenes for ${scrapedPerformer.name || "performer"}`);
                } catch (e) {
                    console.error(`Error scraping from ${stashId.endpoint}:`, e);
                    Toast.error(`Error scraping from ${stashId.endpoint}`);
                }
            }

            if (newScenesCount === 0) {
                Toast.success("No new missing scenes found. Check tracked scenes below.");
            } else {
                Toast.success(`Found ${newScenesCount} new missing scenes`);
            }

            setMissingScenes(allScraped);

            // Refetch potential scenes to update tracked/owned status
            await refetchPotential();
        } catch (e) {
            Toast.error(e);
        } finally {
            setScanning(false);
        }
    };

    const [startBackgroundScan] = GQL.useStartScrapePerformerScenesJobMutation();

    const onScanBackground = async () => {
        if (!performer.stash_ids || performer.stash_ids.length === 0) {
            Toast.error("Performer has no StashBox IDs");
            return;
        }

        for (const stashId of performer.stash_ids) {
            if (!stashId.stash_id || !stashId.endpoint) continue;
            try {
                await startBackgroundScan({
                    variables: {
                        stash_box_endpoint: stashId.endpoint,
                        performer_stash_id: stashId.stash_id,
                    }
                });
                Toast.success(`Started background scan for ${stashId.endpoint}`);
            } catch (e) {
                console.error(e);
                Toast.error(e);
            }
        }
    };

    const onTrack = async (scene: GQL.ScrapedSceneDataFragment) => {
        if (!scene.remote_site_id) return;
        try {
            await createPotentialScene({
                variables: {
                    input: {
                        stash_id: scene.remote_site_id,
                        data: JSON.stringify(scene),
                    }
                }
            });
            setTrackedStatus(prev => ({ ...prev, [scene.remote_site_id!]: true }));
            Toast.success(`Tracked: ${scene.title}`);
        } catch (e) {
            Toast.error(e);
        }
    };

    const onTrackAll = async () => {
        const toTrack = filteredAndSortedScenes.filter(s => s.remote_site_id && !trackedStatus[s.remote_site_id]);
        if (toTrack.length === 0) return;

        Toast.success(`Tracking ${toTrack.length} scenes...`);
        for (const s of toTrack) {
            await onTrack(s);
        }
        Toast.success(`Finished tracking scenes`);
    };

    const toggleSortDirection = () => {
        setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    };

    const statusFilterLabel = {
        all: "All",
        untracked: "Untracked",
        tracked: "Tracked",
        owned: "Owned",
    };

    const sortFieldLabel = {
        date: "Date",
        title: "Title",
        studio: "Studio",
    };

    return (
        <>
            {/* Action Buttons */}
            <div className="my-3 d-flex align-items-center flex-wrap gap-2">
                <Button variant="primary" onClick={onScan} disabled={scanning}>
                    <Icon icon={faSearch} className="mr-2" />
                    <FormattedMessage id="scan_missing_scenes" defaultMessage="Scan for Missing Scenes (StashBox)" />
                </Button>

                <Button variant="secondary" onClick={onScanBackground} disabled={scanning}>
                    <Icon icon={faSearch} className="mr-2" />
                    <FormattedMessage id="scan_missing_scenes_bg" defaultMessage="Scan in Background" />
                </Button>

                {!scanning && filteredAndSortedScenes.filter(s => s.remote_site_id && !trackedStatus[s.remote_site_id]).length > 0 && (
                    <Button variant="success" onClick={onTrackAll}>
                        <Icon icon={faPlus} className="mr-2" />
                        <FormattedMessage id="track_all" defaultMessage="Track All" />
                    </Button>
                )}
            </div>

            {/* Filter/Sort Toolbar */}
            {missingScenes.length > 0 && (
                <div className="mb-3 d-flex flex-wrap align-items-center gap-2 p-2 bg-secondary text-white rounded">
                    {/* Search */}
                    <InputGroup style={{ maxWidth: "250px" }}>
                        <InputGroup.Prepend>
                            <InputGroup.Text><Icon icon={faSearch} /></InputGroup.Text>
                        </InputGroup.Prepend>
                        <Form.Control
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </InputGroup>

                    {/* Studio Filter */}
                    <Form.Control
                        as="select"
                        value={selectedStudio || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectedStudio(e.target.value || null)}
                        style={{ maxWidth: "150px" }}
                        className="custom-select"
                    >
                        <option value="">All Studios</option>
                        {uniqueStudios.map(s => <option key={s} value={s}>{s}</option>)}
                    </Form.Control>

                    {/* Performer Filter */}
                    <Form.Control
                        as="select"
                        value={selectedPerformer || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectedPerformer(e.target.value || null)}
                        style={{ maxWidth: "150px" }}
                        className="custom-select"
                    >
                        <option value="">All Performers</option>
                        {uniquePerformers.map(p => <option key={p} value={p}>{p}</option>)}
                    </Form.Control>

                    {/* Tag Filter */}
                    <Form.Control
                        as="select"
                        value={selectedTag || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectedTag(e.target.value || null)}
                        style={{ maxWidth: "150px" }}
                        className="custom-select"
                    >
                        <option value="">All Tags</option>
                        {uniqueTags.map(t => <option key={t} value={t}>{t}</option>)}
                    </Form.Control>

                    {/* Status Filter */}
                    <DropdownButton
                        as={ButtonGroup}
                        variant="outline-light"
                        title={<><Icon icon={faFilter} className="mr-1" /> {statusFilterLabel[statusFilter]}</>}
                    >
                        {(["all", "untracked", "tracked", "owned"] as StatusFilter[]).map(status => (
                            <Dropdown.Item
                                key={status}
                                active={statusFilter === status}
                                onClick={() => setStatusFilter(status)}
                            >
                                {statusFilterLabel[status]}
                            </Dropdown.Item>
                        ))}
                    </DropdownButton>

                    {/* Sort */}
                    <DropdownButton
                        as={ButtonGroup}
                        variant="outline-light"
                        title={<>Sort: {sortFieldLabel[sortField]}</>}
                    >
                        {(["date", "title", "studio"] as SortField[]).map(field => (
                            <Dropdown.Item
                                key={field}
                                active={sortField === field}
                                onClick={() => setSortField(field)}
                            >
                                {sortFieldLabel[field]}
                            </Dropdown.Item>
                        ))}
                    </DropdownButton>

                    <Button
                        variant="outline-light"
                        onClick={toggleSortDirection}
                        title={sortDirection === "asc" ? "Ascending" : "Descending"}
                    >
                        <Icon icon={sortDirection === "asc" ? faSortAmountUp : faSortAmountDown} />
                    </Button>

                    {/* Stats Summary */}
                    <div className="ml-auto d-flex align-items-center gap-2">
                        <span className="badge bg-info text-white px-2 py-1" title="Owned (in library)">
                            {Object.keys(ownedStatus).length} Owned
                        </span>
                        <span className="badge bg-success text-white px-2 py-1" title="Tracked (not in library)">
                            {Object.keys(trackedStatus).filter(k => trackedStatus[k] && !ownedStatus[k]).length} Tracked
                        </span>
                        <span className="badge bg-secondary text-white px-2 py-1" title="Total scenes">
                            {missingScenes.length} Total
                        </span>
                    </div>
                </div>
            )}

            {scanning && <LoadingIndicator />}

            {!scanning && paginatedScenes.length > 0 && (
                <>
                    <ScrapedSceneCardsGrid
                        scenes={paginatedScenes}
                        trackedStatus={trackedStatus}
                        ownedStatus={ownedStatus}
                        trailerUrls={trailerUrls}
                        onTrack={onTrack}
                    />

                    {/* Pagination */}
                    {filteredAndSortedScenes.length > itemsPerPage && (
                        <div className="d-flex justify-content-center mt-4">
                            <Pagination
                                itemsPerPage={itemsPerPage}
                                currentPage={currentPage}
                                totalItems={filteredAndSortedScenes.length}
                                onChangePage={setCurrentPage}
                            />
                        </div>
                    )}
                </>
            )}

            {!scanning && missingScenes.length > 0 && paginatedScenes.length === 0 && (
                <div className="text-center text-muted py-4">
                    No scenes match the current filters.
                </div>
            )}
        </>
    );
};

