import React from "react";
import { Button, Card, CardContent, Box } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";
import cx from "classnames";

interface IScrapedSceneCardProps {
    scene: GQL.ScrapedSceneDataFragment;
    tracked: boolean;
    onTrack: (scene: GQL.ScrapedSceneDataFragment) => void;
}

export const ScrapedSceneCard: React.FC<IScrapedSceneCardProps> = ({
    scene,
    tracked,
    onTrack,
}) => {
    const imageUrl = scene.image;
    const sceneUrl = scene.urls && scene.urls.length > 0 ? scene.urls[0] : undefined;

    const titleText = scene.title ?? "Unknown Title";
    const duration = scene.duration ? TextUtils.secondsToTimestamp(scene.duration) : null;

    return (
        <Card className={cx("grid-card transition-transform duration-300 hover:scale-105 hover:z-50 hover:shadow-2xl bg-card border-none rounded-md overflow-hidden", { tracked })}>
            <div className="thumbnail-section relative aspect-video">
                {sceneUrl ? (
                    <a href={sceneUrl} target="_blank" rel="noreferrer" className="d-block w-full h-full">
                        <div className="scene-card-preview w-full h-full">
                            {imageUrl ? (
                                <img
                                    src={imageUrl}
                                    alt={titleText}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <div className="w-full h-full d-flex align-items-center justify-content-center bg-secondary text-white">
                                    <span className="opacity-50">No Image</span>
                                </div>
                            )}
                        </div>
                    </a>
                ) : (
                    <div className="scene-card-preview w-full h-full">
                        {imageUrl ? (
                            <img
                                src={imageUrl}
                                alt={titleText}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <div className="w-full h-full d-flex align-items-center justify-content-center bg-secondary text-white">
                                <span className="opacity-50">No Image</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Overlays */}
                {duration && <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-xs text-white font-medium">{duration}</div>}
                <div className="absolute top-1 right-1 flex gap-1">
                    <Button
                        variant="contained"
                        color={tracked ? "success" : "secondary"}
                        size="small"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!tracked) onTrack(scene);
                        }}
                        className={cx("p-1.5 rounded-full shadow-sm leading-none", { "cursor-default": tracked })}
                        disabled={tracked}
                        title={tracked ? "Tracked" : "Track Scene"}
                    >
                        {tracked ? <CheckIcon sx={{ fontSize: 12 }} /> : <AddIcon sx={{ fontSize: 12 }} />}
                    </Button>
                </div>
            </div>

            <div className="card-section p-2 bg-card">
                <h5 className="card-section-title text-sm font-medium truncate mb-1" title={titleText}>
                    {sceneUrl ? (
                        <a href={sceneUrl} target="_blank" rel="noreferrer" className="text-card-foreground hover:text-primary transition-colors">
                            {titleText}
                        </a>
                    ) : (
                        <span className="text-card-foreground">{titleText}</span>
                    )}
                </h5>
                <div className="scene-card-details text-xs text-muted-foreground flex justify-between">
                    <span>{scene.date}</span>
                    {scene.studio && (
                        <span className="truncate ml-2" title={scene.studio.name}>
                            {scene.studio.name}
                        </span>
                    )}
                </div>
            </div>
        </Card>
    );
};
