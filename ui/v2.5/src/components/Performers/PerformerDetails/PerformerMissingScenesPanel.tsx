import React, { useState, useMemo } from "react";
import { Button, Table } from "react-bootstrap";
import { FormattedMessage } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useToast } from "src/hooks/Toast";
import { LoadingIndicator } from "src/components/Shared/LoadingIndicator";
import { useConfigurationContext } from "src/hooks/Config";
import { Icon } from "src/components/Shared/Icon";
import { faPlus, faSearch } from "@fortawesome/free-solid-svg-icons";
import { getClient } from "src/core/StashService";
import { ScrapedSceneCardsGrid } from "src/components/Scenes/ScrapedSceneCardsGrid";

interface IPerformerMissingScenesPanelProps {
    active: boolean;
    performer: GQL.PerformerDataFragment;
}

export const PerformerMissingScenesPanel: React.FC<IPerformerMissingScenesPanelProps> = ({
    active,
    performer,
}) => {
    const [scanning, setScanning] = useState(false);
    const [missingScenes, setMissingScenes] = useState<GQL.ScrapedSceneDataFragment[]>([]);
    const [trackedStatus, setTrackedStatus] = useState<Record<string, boolean>>({});
    const [ownedStatus, setOwnedStatus] = useState<Record<string, boolean>>({});
    const { configuration } = useConfigurationContext();
    const Toast = useToast();

    // Create/Destroy hooks
    const [createPotentialScene] = GQL.usePotentialSceneCreateMutation();

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
                    // Check if existing_scene is present (scene exists locally)
                    if (ps.existing_scene?.id) {
                        newOwnedStatus[ps.stash_id] = true;
                    }
                } catch (e) {
                    console.error("Failed to parse potential scene data", e);
                }
            });

            if (!scanning && loadedScenes.length > 0) {
                setMissingScenes(prev => {
                    return loadedScenes;
                });
                setTrackedStatus(newTrackedStatus);
                setOwnedStatus(newOwnedStatus);
            }
        }
    }, [potentialData, scanning]);

    const onScan = async () => {
        setScanning(true);
        // Don't clear immediately if we want to merge? 
        // Desired: "Scan" finds NEW missing scenes.
        // If we clear, we lose "Tracked" scenes display until we fetch them again or merge.
        // Let's Keep existing tracked scenes and merge new ones!
        // setMissingScenes([]); 
        // setTrackedStatus({}); // Don't clear tracked status

        try {
            const client = getClient();
            const allScraped: GQL.ScrapedSceneDataFragment[] = [...missingScenes]; // Start with existing
            const stashFieldsToCheck: string[] = [];

            // ... (Rest of scanning logic)
            // inside loop:
            // if (!allScraped.some(...)) allScraped.push(s);

            // ...
            setMissingScenes(allScraped);
        } catch (e) {
            Toast.error(e);
        } finally {
            setScanning(false);
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
        const toTrack = missingScenes.filter(s => s.remote_site_id && !trackedStatus[s.remote_site_id]);
        if (toTrack.length === 0) return;

        Toast.success(`Tracking ${toTrack.length} scenes...`);

        for (const s of toTrack) {
            // Silence individual success toasts? Or pass flag?
            // For now just calling existing onTrack
            await onTrack(s);
        }
        Toast.success(`Finished tracking scenes`);
    };

    return (
        <>
            <div className="my-3 d-flex align-items-center">
                <Button variant="primary" onClick={onScan} disabled={scanning} className="mr-2">
                    <Icon icon={faSearch} className="mr-2" />
                    <FormattedMessage id="scan_missing_scenes" defaultMessage="Scan for Missing Scenes (StashBox)" />
                </Button>

                {!scanning && missingScenes.length > 0 && (
                    <Button variant="success" onClick={onTrackAll} className="ml-2">
                        <Icon icon={faPlus} className="mr-2" />
                        <FormattedMessage id="track_all" defaultMessage="Track All" />
                    </Button>
                )}
            </div>

            {scanning && <LoadingIndicator />}

            {!scanning && missingScenes.length > 0 && (
                <ScrapedSceneCardsGrid
                    scenes={missingScenes}
                    trackedStatus={trackedStatus}
                    ownedStatus={ownedStatus}
                    onTrack={onTrack}
                />
            )}
        </>
    );
};
