import React from "react";
import { SceneCard } from "./SceneCard";
import * as GQL from "src/core/generated-graphql";
import { Button, Badge } from "react-bootstrap";
import { Icon } from "../Shared/Icon";
import { faTag, faCheck } from "@fortawesome/free-solid-svg-icons";

interface IScrapedSceneCardsGridProps {
    scenes: GQL.ScrapedSceneDataFragment[];
    trackedStatus: Record<string, boolean>;
    ownedStatus: Record<string, boolean>; // NEW: Maps stash_id to whether scene exists locally
    onTrack: (scene: GQL.ScrapedSceneDataFragment) => void;
}

function scrapedToSlim(scraped: GQL.ScrapedSceneDataFragment): GQL.SlimSceneDataFragment {
    return {
        id: scraped.remote_site_id || scraped.title || "temp-id",
        title: scraped.title,
        details: scraped.details,
        url: scraped.urls?.[0],
        date: scraped.date,
        rating100: null,
        o_counter: null,
        organized: false,
        interactive: false,
        interactive_speed: null,
        resume_time: null,
        play_duration: null,
        files: [],
        paths: {
            screenshot: scraped.image,
            preview: null,
            stream: null,
            vtt: null,
            chapters_vtt: null,
            sprite: null,
            funscript: null,
            interactive_heatmap: null,
            caption: null,
        },
        scene_markers: [],
        galleries: [],
        studio: scraped.studio ? {
            id: scraped.studio.stored_id || scraped.studio.remote_site_id || "studio-id",
            name: scraped.studio.name,
            image_path: scraped.studio.image,
            parent_studio: null,
        } : null,
        movies: [],
        performers: scraped.performers ? scraped.performers.map(p => ({
            id: p.stored_id || "perf-id",
            name: p.name,
            gender: p.gender,
            image_path: p.images?.[0] || null,
            favorite: false,
        })) : [],
        tags: scraped.tags ? scraped.tags.map(t => ({
            id: t.stored_id || "tag-id",
            name: t.name,
        })) : [],
        stash_ids: [],
    } as unknown as GQL.SlimSceneDataFragment;
}

export const ScrapedSceneCardsGrid: React.FC<IScrapedSceneCardsGridProps> = ({
    scenes,
    trackedStatus,
    ownedStatus,
    onTrack,
}) => {
    if (!scenes || scenes.length === 0) return null;

    return (
        <div className="row justify-content-center">
            {scenes.map((scene, index) => {
                const slimScene = scrapedToSlim(scene);
                const stashId = scene.remote_site_id;
                const isTracked = !!(stashId && trackedStatus[stashId]);
                const isOwned = !!(stashId && ownedStatus[stashId]);

                // Determine button state: Owned > Tracked > Track
                let buttonVariant: "info" | "success" | "secondary" = "secondary";
                let buttonText = " Track";
                let buttonIcon = faTag;
                let buttonDisabled = false;

                if (isOwned) {
                    buttonVariant = "info";
                    buttonText = " Owned";
                    buttonIcon = faCheck;
                    buttonDisabled = true;
                } else if (isTracked) {
                    buttonVariant = "success";
                    buttonText = " Tracked";
                    buttonIcon = faTag;
                    buttonDisabled = true;
                }

                return (
                    <div
                        key={stashId ?? index}
                        className="col-xl-3 col-lg-4 col-md-6 col-sm-12 col-12 mb-3"
                    >
                        <SceneCard
                            scene={slimScene}
                            link={scene.urls?.[0] || undefined}
                            extraActions={
                                <Button
                                    className={`btn-track ${isOwned ? "owned" : isTracked ? "tracked" : ""}`}
                                    variant={buttonVariant}
                                    size="sm"
                                    onClick={() => onTrack(scene)}
                                    title={buttonText.trim()}
                                    disabled={buttonDisabled}
                                >
                                    <Icon icon={buttonIcon} />
                                    {buttonText}
                                </Button>
                            }
                        />
                    </div>
                );
            })}
        </div>
    );
};
