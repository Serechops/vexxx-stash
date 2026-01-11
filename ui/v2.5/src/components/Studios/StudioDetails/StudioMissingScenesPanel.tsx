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

interface IStudioMissingScenesPanelProps {
    active: boolean;
    studio: GQL.StudioDataFragment;
    showChildStudioContent?: boolean;
}

export const StudioMissingScenesPanel: React.FC<IStudioMissingScenesPanelProps> = ({
    active,
    studio,
}) => {
    const [scanning, setScanning] = useState(false);
    const [missingScenes, setMissingScenes] = useState<GQL.ScrapedSceneDataFragment[]>([]);
    const [trackedStatus, setTrackedStatus] = useState<Record<string, boolean>>({});
    const { configuration } = useConfigurationContext();
    const Toast = useToast();

    // Create/Destroy hooks
    const [createPotentialScene] = GQL.usePotentialSceneCreateMutation();

    const stashBoxEndpoints = useMemo(() => {
        return configuration?.general.stashBoxes || [];
    }, [configuration]);

    const onScan = async () => {
        setScanning(true);
        setMissingScenes([]);
        setTrackedStatus({});

        try {
            const client = getClient();
            const allScraped: GQL.ScrapedSceneDataFragment[] = [];
            const stashFieldsToCheck: string[] = [];

            // 1. Scrape from all StashBox endpoints
            for (const endpoint of stashBoxEndpoints) {
                // Query StashBox using Studio Name
                if (!studio.name) continue;

                const result = await client.query<GQL.ScrapeSingleSceneQuery, GQL.ScrapeSingleSceneQueryVariables>({
                    query: GQL.ScrapeSingleSceneDocument,
                    variables: {
                        source: { stash_box_endpoint: endpoint.endpoint },
                        input: { query: studio.name },
                    },
                    fetchPolicy: "network-only",
                });

                const scenes = result.data.scrapeSingleScene;
                if (scenes && Array.isArray(scenes)) {
                    scenes.forEach((s: any) => {
                        // Check if already present in result
                        if (!allScraped.some(existing => existing.remote_site_id === s.remote_site_id)) {
                            allScraped.push(s);
                            if (s.remote_site_id) stashFieldsToCheck.push(s.remote_site_id);
                        }
                    })
                }
            }

            // 2. Check Potential list
            if (stashFieldsToCheck.length > 0) {
                const potentialResult = await client.query<GQL.FindPotentialScenesQuery, GQL.FindPotentialScenesQueryVariables>({
                    query: GQL.FindPotentialScenesDocument,
                    variables: {
                        stash_ids: stashFieldsToCheck,
                    },
                    fetchPolicy: "network-only",
                });

                const trackedMap: Record<string, boolean> = {};
                potentialResult.data.findPotentialScenes.forEach(p => {
                    trackedMap[p.stash_id] = true;
                });
                setTrackedStatus(trackedMap);
            }

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

    return (
        <>
            <div className="mt-3">
                <Button variant="primary" onClick={onScan} disabled={scanning}>
                    <Icon icon={faSearch} className="mr-2" />
                    <FormattedMessage id="scan_missing_scenes" defaultMessage="Scan for Missing Scenes (StashBox)" />
                </Button>
            </div>

            {scanning && <LoadingIndicator />}

            {!scanning && missingScenes.length > 0 && (
                <Table striped bordered hover className="mt-3">
                    <thead>
                        <tr>
                            <th>Image</th>
                            <th>Title</th>
                            <th>Date</th>
                            <th>Studio</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {missingScenes.map((scene, idx) => {
                            const isTracked = scene.remote_site_id && trackedStatus[scene.remote_site_id];
                            return (
                                <tr key={idx}>
                                    <td style={{ width: "120px" }}>
                                        {scene.image && <img src={scene.image} alt="thumb" style={{ maxWidth: "100px" }} />}
                                    </td>
                                    <td>
                                        {scene.urls ? (
                                            <a href={scene.urls[0]} target="_blank" rel="noreferrer">{scene.title}</a>
                                        ) : scene.title}
                                    </td>
                                    <td>{scene.date}</td>
                                    <td>{scene.studio?.name}</td>
                                    <td>
                                        {isTracked ? (
                                            <span className="text-success">Tracked</span>
                                        ) : (
                                            <Button size="sm" onClick={() => onTrack(scene)}>
                                                <Icon icon={faPlus} /> Track
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            )}
        </>
    );
};
