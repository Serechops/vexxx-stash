import React from "react";
import { SceneCard } from "./SceneCard";
import * as GQL from "src/core/generated-graphql";
import { Button } from "@mui/material";
import { Icon } from "../Shared/Icon";
import { faTag, faCheck, faCircle } from "@fortawesome/free-solid-svg-icons";

interface IScrapedSceneCardsGridProps {
    scenes: GQL.ScrapedSceneDataFragment[];
    trackedStatus: Record<string, boolean>;
    ownedStatus: Record<string, boolean>;
    trailerUrls?: Record<string, string>; // Maps scene URL to trailer URL
    onTrack: (scene: GQL.ScrapedSceneDataFragment) => void;
}

function scrapedToSlim(scraped: GQL.ScrapedSceneDataFragment, trailerUrl?: string): GQL.SlimSceneDataFragment {
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
            preview: trailerUrl || null, // Use trailer URL for preview if available
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
            id: p.stored_id || p.name,
            name: p.name,
            gender: p.gender,
            image_path: p.images?.[0] || null,
            favorite: false,
        })) : [],
        tags: scraped.tags ? scraped.tags.map(t => ({
            id: t.stored_id || t.name,
            name: t.name,
        })) : [],
        stash_ids: [],
    } as unknown as GQL.SlimSceneDataFragment;
}

export const ScrapedSceneCardsGrid: React.FC<IScrapedSceneCardsGridProps> = ({
    scenes,
    trackedStatus,
    ownedStatus,
    trailerUrls = {},
    onTrack,
}) => {
    if (!scenes || scenes.length === 0) return null;

    return (
        <div className="row justify-content-center">
            {scenes.map((scene, index) => {
                const sceneUrl = scene.urls?.[0];
                const trailerUrl = sceneUrl ? trailerUrls[sceneUrl] : undefined;
                const slimScene = scrapedToSlim(scene, trailerUrl);
                const stashId = scene.remote_site_id;
                const isTracked = !!(stashId && trackedStatus[stashId]);
                const isOwned = !!(stashId && ownedStatus[stashId]);
                const hasTrailer = !!trailerUrl;

                // Determine button state: Owned > Tracked > Track
                let buttonColor: "info" | "success" | "secondary" = "secondary";
                let buttonText = " Track";
                let buttonIcon = faTag;
                let buttonDisabled = false;

                if (isOwned) {
                    buttonColor = "info";
                    buttonText = " Owned";
                    buttonIcon = faCheck;
                    buttonDisabled = true;
                } else if (isTracked) {
                    buttonColor = "success";
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
                                <div className="d-flex align-items-center gap-1">
                                    {hasTrailer && (
                                        <span className="text-success" title="Trailer available">
                                            <Icon icon={faCircle} className="fa-xs" />
                                        </span>
                                    )}
                                    <Button
                                        className={`btn-track ${isOwned ? "owned" : isTracked ? "tracked" : ""}`}
                                        variant="contained"
                                        color={buttonColor}
                                        size="small"
                                        onClick={() => onTrack(scene)}
                                        title={buttonText.trim()}
                                        disabled={buttonDisabled}
                                    >
                                        <Icon icon={buttonIcon} />
                                        {buttonText}
                                    </Button>
                                </div>
                            }
                        />
                    </div>
                );
            })}
        </div>
    );
};

