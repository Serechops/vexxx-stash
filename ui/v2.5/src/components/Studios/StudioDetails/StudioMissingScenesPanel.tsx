import React, { useState, useMemo } from "react";
import Select from "react-select";
import {
    Button,
    TextField,
    InputAdornment,
    Box,
    Chip,
    IconButton,
    Select as MuiSelect,
    MenuItem,
    FormControl,
    InputLabel,
    Stack,
    Typography
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { useConfigurationContext } from "src/hooks/Config";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import SortIcon from "@mui/icons-material/Sort";
import FilterListIcon from "@mui/icons-material/FilterList";
import { getClient } from "src/core/StashService";
import { ScrapedSceneCardsGrid } from "src/components/Scenes/ScrapedSceneCardsGrid";
import { Pagination } from "src/components/List/Pagination";

interface IStudioMissingScenesPanelProps {
    active: boolean;
    studio: GQL.StudioDataFragment;
    showChildStudioContent?: boolean;
}

type StatusFilter = "all" | "untracked" | "tracked" | "owned";
type SortField = "date" | "title" | "studio";
type SortDirection = "asc" | "desc";
type Option = { label: string; value: string };

export const StudioMissingScenesPanel: React.FC<IStudioMissingScenesPanelProps> = ({
    active,
    studio,
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
    const [startBackgroundScan] = GQL.useStartScrapeStudioScenesJobMutation();

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
                studio_stash_id: studio.stash_ids?.[0]?.stash_id
            }
        },
        skip: !studio.stash_ids || studio.stash_ids.length === 0,
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

            // Merge loaded scenes with existing missing scenes
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
    }, [potentialData]);

    // Fetch trailers
    React.useEffect(() => {
        if (active && missingScenes.length > 0 && !trailersFetched && !scrapingTrailers) {
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

        // Apply filters
        if (selectedStudio) {
            result = result.filter(s => s.studio?.name === selectedStudio);
        }
        if (selectedPerformer) {
            result = result.filter(s => s.performers?.some(p => p.name === selectedPerformer));
        }
        if (selectedTag) {
            result = result.filter(s => s.tags?.some(t => t.name === selectedTag));
        }

        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            result = result.filter(s =>
                s.title?.toLowerCase().includes(term) ||
                s.studio?.name?.toLowerCase().includes(term) ||
                s.performers?.some(p => p.name?.toLowerCase().includes(term))
            );
        }

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
    }, [missingScenes, searchTerm, statusFilter, sortField, sortDirection, trackedStatus, ownedStatus, selectedStudio, selectedPerformer, selectedTag]);

    const paginatedScenes = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredAndSortedScenes.slice(start, start + itemsPerPage);
    }, [filteredAndSortedScenes, currentPage, itemsPerPage]);

    // Reset page on filter change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter, sortField, sortDirection, selectedStudio, selectedPerformer, selectedTag]);

    const onScan = async () => {
        setScanning(true);
        // Don't clear missingScenes, append/merge instead if we can, but since this is loosely based on name query, replacing might be safer or we check dups
        // For name based scan, we might get different results than ID based.
        // Let's keep the existing behaviour of clearing for name-based scan? 
        // Or better, let's behave like Performer: merge.

        try {
            const client = getClient();
            const allScraped: GQL.ScrapedSceneDataFragment[] = [...missingScenes];
            const existingIds = new Set(allScraped.map(s => s.remote_site_id));
            let newScenesCount = 0;

            for (const endpoint of stashBoxEndpoints) {
                if (!studio.name) continue;

                // TODO: Using query by name is imperfect. Preferably we use StashID if available, but for now we keep the feature parity with old panel 
                // plus the new background task which is ID based.
                // If the user wants ID based foreground, we'd need a new mutation.
                const result = await client.query<GQL.ScrapeSingleSceneQuery, GQL.ScrapeSingleSceneQueryVariables>({
                    query: GQL.ScrapeSingleSceneDocument,
                    variables: {
                        source: { stash_box_endpoint: endpoint.endpoint },
                        input: { query: studio.name },
                    },
                    fetchPolicy: "network-only",
                });

                const scenes = result.data.scrapeSingleScene || [];
                scenes.forEach((s: any) => {
                    if (s.remote_site_id && !existingIds.has(s.remote_site_id)) {
                        allScraped.push(s);
                        existingIds.add(s.remote_site_id);
                        newScenesCount++;
                    }
                });
            }

            if (newScenesCount === 0) {
                Toast.success("No new missing scenes found.");
            } else {
                Toast.success(`Found ${newScenesCount} new missing scenes`);
            }

            setMissingScenes(allScraped);
            await refetchPotential();
        } catch (e) {
            Toast.error(e);
        } finally {
            setScanning(false);
        }
    };

    const onScanBackground = async () => {
        if (!studio.stash_ids || studio.stash_ids.length === 0) {
            Toast.error("Studio has no StashBox IDs");
            return;
        }

        for (const stashId of studio.stash_ids) {
            if (!stashId.stash_id || !stashId.endpoint) continue;
            try {
                await startBackgroundScan({
                    variables: {
                        stash_box_endpoint: stashId.endpoint,
                        studio_stash_id: stashId.stash_id,
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
            <Stack direction="row" spacing={2} sx={{ my: 3, flexWrap: "wrap" }}>
                <Button variant="contained" color="primary" onClick={onScan} disabled={scanning}>
                    <SearchIcon sx={{ mr: 1 }} />
                    <FormattedMessage id="scan_missing_scenes" defaultMessage="Scan for Missing Scenes (StashBox)" />
                </Button>

                <Button variant="contained" color="secondary" onClick={onScanBackground} disabled={scanning}>
                    <SearchIcon sx={{ mr: 1 }} />
                    <FormattedMessage id="scan_missing_scenes_bg" defaultMessage="Scan in Background" />
                </Button>

                {!scanning && filteredAndSortedScenes.filter(s => s.remote_site_id && !trackedStatus[s.remote_site_id]).length > 0 && (
                    <Button variant="contained" color="success" onClick={onTrackAll}>
                        <AddIcon sx={{ mr: 1 }} />
                        <FormattedMessage id="track_all" defaultMessage="Track All" />
                    </Button>
                )}
            </Stack>

            {/* Filter/Sort Toolbar */}
            {missingScenes.length > 0 && (
                <Box sx={{
                    mb: 3,
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 2,
                    p: 2,
                    bgcolor: "action.hover",
                    borderRadius: 1
                }}>
                    {/* Search */}
                    <TextField
                        variant="outlined"
                        size="small"
                        placeholder={intl.formatMessage({ id: "Search..." })}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        slotProps={{
                            input: {
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" />
                                    </InputAdornment>
                                ),
                            },
                        }}
                        sx={{ maxWidth: "250px" }}
                    />

                    {/* Studio Filter */}
                    <Box sx={{ width: "200px", color: "text.primary" }}>
                        <Select
                            className="react-select"
                            classNamePrefix="react-select"
                            options={uniqueStudios.map(s => ({ label: s, value: s }))}
                            value={selectedStudio ? { label: selectedStudio, value: selectedStudio } : null}
                            onChange={(option: Option | null) => setSelectedStudio(option ? option.value : null)}
                            placeholder="All Studios"
                            isClearable
                            menuPortalTarget={document.body}
                            styles={{
                                menuPortal: base => ({ ...base, zIndex: 9999 }),
                            }}
                        />
                    </Box>

                    {/* Performer Filter */}
                    <Box sx={{ width: "200px", color: "text.primary" }}>
                        <Select
                            className="react-select"
                            classNamePrefix="react-select"
                            options={uniquePerformers.map(p => ({ label: p, value: p }))}
                            value={selectedPerformer ? { label: selectedPerformer, value: selectedPerformer } : null}
                            onChange={(option: Option | null) => setSelectedPerformer(option ? option.value : null)}
                            placeholder="All Performers"
                            isClearable
                            menuPortalTarget={document.body}
                            styles={{
                                menuPortal: base => ({ ...base, zIndex: 9999 }),
                            }}
                        />
                    </Box>

                    {/* Tag Filter */}
                    <Box sx={{ width: "200px", color: "text.primary" }}>
                        <Select
                            className="react-select"
                            classNamePrefix="react-select"
                            options={uniqueTags.map(t => ({ label: t, value: t }))}
                            value={selectedTag ? { label: selectedTag, value: selectedTag } : null}
                            onChange={(option: Option | null) => setSelectedTag(option ? option.value : null)}
                            placeholder="All Tags"
                            isClearable
                            menuPortalTarget={document.body}
                            styles={{
                                menuPortal: base => ({ ...base, zIndex: 9999 }),
                            }}
                        />
                    </Box>

                    {/* Status Filter */}
                    <FormControl size="small" variant="outlined" sx={{ minWidth: 150 }}>
                        <InputLabel>Status</InputLabel>
                        <MuiSelect
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                            label="Status"
                        >
                            {(["all", "untracked", "tracked", "owned"] as StatusFilter[]).map(status => (
                                <MenuItem key={status} value={status}>
                                    <FilterListIcon sx={{ mr: 0.5, fontSize: 16 }} /> {statusFilterLabel[status]}
                                </MenuItem>
                            ))}
                        </MuiSelect>
                    </FormControl>

                    {/* Sort */}
                    <FormControl size="small" variant="outlined" sx={{ minWidth: 150 }}>
                        <InputLabel>Sort</InputLabel>
                        <MuiSelect
                            value={sortField}
                            onChange={(e) => setSortField(e.target.value as SortField)}
                            label="Sort"
                        >
                            {(["date", "title", "studio"] as SortField[]).map(field => (
                                <MenuItem key={field} value={field}>
                                    {sortFieldLabel[field]}
                                </MenuItem>
                            ))}
                        </MuiSelect>
                    </FormControl>

                    <IconButton
                        onClick={toggleSortDirection}
                        title={sortDirection === "asc" ? "Ascending" : "Descending"}
                        size="small"
                    >
                        <SortIcon sx={{ transform: sortDirection === "asc" ? "scaleY(-1)" : "none" }} />
                    </IconButton>

                    {/* Stats Summary */}
                    <Stack direction="row" spacing={1} sx={{ ml: "auto" }}>
                        <Chip
                            label={`${Object.keys(ownedStatus).length} Owned`}
                            color="info"
                            size="small"
                            title="Owned (in library)"
                        />
                        <Chip
                            label={`${Object.keys(trackedStatus).filter(k => trackedStatus[k] && !ownedStatus[k]).length} Missing`}
                            color="success"
                            size="small"
                            title="Tracked (not in library)"
                        />
                        <Chip
                            label={`${missingScenes.length} Total`}
                            color="default"
                            size="small"
                            title="Total scenes"
                        />
                    </Stack>
                </Box>
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
                        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
                            <Pagination
                                itemsPerPage={itemsPerPage}
                                currentPage={currentPage}
                                totalItems={filteredAndSortedScenes.length}
                                onChangePage={setCurrentPage}
                            />
                        </Box>
                    )}
                </>
            )}

            {!scanning && missingScenes.length > 0 && paginatedScenes.length === 0 && (
                <div className="text-center py-4" style={{ color: '#a1a1aa' }}>
                    No scenes match the current filters.
                </div>
            )}
        </>
    );
};
