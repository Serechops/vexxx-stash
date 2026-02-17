import React, { useEffect, useRef } from "react";
import { Link, useHistory } from "react-router-dom";
import { Box } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { FormattedMessage } from "react-intl";
import { SceneCard } from "../Scenes/SceneCard";
import { PerformerCard } from "../Performers/PerformerCard";
import { ImageCard } from "../Images/ImageCard";
import { GalleryCard } from "../Galleries/GalleryCard";

interface GlobalSearchResultsProps {
    data: GQL.GlobalSearchQuery;
    selectedIndex: number;
    setSelectedIndex: (index: number) => void;
    onSelect: () => void;
}

type ResultType = "scene" | "performer" | "studio" | "tag" | "image" | "gallery";

type FlatResultItem = {
    type: ResultType;
    id: string;
    data: any; // Raw GQL segment
    url: string;
};

export const GlobalSearchResults: React.FC<GlobalSearchResultsProps> = ({
    data,
    selectedIndex,
    setSelectedIndex,
    onSelect,
}) => {
    const history = useHistory();
    const items: FlatResultItem[] = [];

    // 1. Flatten results to maintain a linear index for keyboard nav
    const sceneItems = (data.scenes?.scenes || []).filter((s): s is GQL.SlimSceneDataFragment => !!s);
    sceneItems.forEach(s => items.push({ type: "scene", id: s.id, data: s, url: `/scenes/${s.id}` }));

    const performerItems = (data.performers?.performers || []).filter((p): p is GQL.PerformerDataFragment => !!p);
    performerItems.forEach(p => items.push({ type: "performer", id: p.id, data: p, url: `/performers/${p.id}` }));

    const imageItems = (data.images?.images || []).filter((i): i is GQL.SlimImageDataFragment => !!i);
    imageItems.forEach(i => items.push({ type: "image", id: i.id, data: i, url: `/images/${i.id}` }));

    const galleryItems = (data.galleries?.galleries || []).filter((g): g is GQL.SlimGalleryDataFragment => !!g);
    galleryItems.forEach(g => items.push({ type: "gallery", id: g.id, data: g, url: `/galleries/${g.id}` }));

    const studioItems = (data.studios?.studios || []).filter((s): s is GQL.SlimStudioDataFragment => !!s);
    studioItems.forEach(s => items.push({ type: "studio", id: s.id, data: s, url: `/studios/${s.id}` }));

    const tagItems = (data.tags?.tags || []).filter((t): t is GQL.SlimTagDataFragment => !!t);
    tagItems.forEach(t => items.push({ type: "tag", id: t.id, data: t, url: `/tags/${t.id}` }));


    // Scroll active item into view
    const activeItemRef = useRef<HTMLDivElement | HTMLAnchorElement>(null);
    useEffect(() => {
        if (activeItemRef.current) {
            activeItemRef.current.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
            });
        }
    }, [selectedIndex]);

    // Ensure selected index is within bounds
    useEffect(() => {
        if (selectedIndex >= items.length) {
            setSelectedIndex(Math.max(0, items.length - 1));
        }
    }, [items.length, selectedIndex, setSelectedIndex]);

    if (items.length === 0) {
        return (
            <Box
                sx={{
                    p: '1.5rem',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    flexShrink: 0,
                }}
            >
                <span style={{ color: "rgba(255,255,255,0.5)" }}>
                    <FormattedMessage id="no_results" defaultMessage="No results found" />
                </span>
            </Box>
        );
    }

    const cardWrapperSx = (isActive: boolean) => ({
        position: 'relative',
        transition: 'transform 0.15s ease-out',
        borderRadius: '8px',
        ...(isActive && {
            transform: 'scale(1.02)',
            boxShadow: '0 0 0 3px #3b82f6',
            zIndex: 10,
        }),
        '& .card': {
            mb: '0 !important',
        },
    });

    // Helper to render Cards
    const renderCard = (item: FlatResultItem, isActive: boolean) => {
        const commonProps = {
            selected: isActive,
            selecting: false,
            zoomIndex: 0,
        };

        switch (item.type) {
            case "scene":
                return (
                    <Box
                        key={item.id}
                        sx={cardWrapperSx(isActive)}
                        data-active={isActive || undefined}
                        ref={isActive ? activeItemRef as any : null}
                        onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
                        onClick={(e) => {
                            if (!e.defaultPrevented) {
                                onSelect();
                            }
                        }}
                    >
                        <SceneCard scene={item.data} {...commonProps} />
                    </Box>
                );
            case "performer":
                return (
                    <Box
                        key={item.id}
                        sx={cardWrapperSx(isActive)}
                        data-active={isActive || undefined}
                        ref={isActive ? activeItemRef as any : null}
                        onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
                        onClick={() => onSelect()}
                    >
                        <PerformerCard performer={item.data} {...commonProps} />
                    </Box>
                );
            case "image":
                return (
                    <Box
                        key={item.id}
                        sx={cardWrapperSx(isActive)}
                        data-active={isActive || undefined}
                        ref={isActive ? activeItemRef as any : null}
                        onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
                        onClick={() => onSelect()}
                    >
                        <ImageCard image={item.data} {...commonProps} />
                    </Box>
                );
            case "gallery":
                return (
                    <Box
                        key={item.id}
                        sx={cardWrapperSx(isActive)}
                        data-active={isActive || undefined}
                        ref={isActive ? activeItemRef as any : null}
                        onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
                        onClick={() => onSelect()}
                    >
                        <GalleryCard gallery={item.data} {...commonProps} />
                    </Box>
                );
            default:
                // Handled in renderListItem
                return null;
        }
    };

    const renderListItem = (item: FlatResultItem, isActive: boolean) => {
        return (
            <Box
                component={Link}
                key={item.id}
                to={item.url}
                data-active={isActive || undefined}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    p: '0.75rem',
                    background: isActive ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '6px',
                    color: isActive ? 'white' : '#ddd',
                    textDecoration: 'none',
                    transition: 'all 0.1s',
                    boxShadow: isActive ? 'inset 3px 0 0 #3b82f6' : 'none',
                    '&:hover': {
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: 'white',
                        textDecoration: 'none',
                    },
                }}
                onClick={onSelect}
                ref={isActive ? activeItemRef as any : null}
                onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
            >
                {item.data.image_path ? (
                    <Box
                        component="img"
                        src={item.data.image_path}
                        alt=""
                        sx={{
                            width: 32,
                            height: 32,
                            borderRadius: '4px',
                            objectFit: 'cover',
                            background: '#222',
                        }}
                    />
                ) : (
                    <Box
                        sx={{
                            width: 32,
                            height: 32,
                            borderRadius: '4px',
                            background: '#222',
                        }}
                    />
                )}
                <div>
                    <div>{item.data.name}</div>
                </div>
            </Box>
        );
    }

    const sectionSx = { mb: '2rem' };
    const sectionTitleSx = {
        fontSize: '1rem',
        textTransform: 'uppercase',
        color: 'rgba(255, 255, 255, 0.6)',
        letterSpacing: '0.1em',
        mb: '1rem',
        fontWeight: 700,
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        pb: '0.5rem',
    };
    const gridSx = {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '1rem',
    };
    const listGridSx = {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '0.5rem',
    };

    return (
        <Box
            data-search-results
            sx={{
                flex: 1,
                overflowY: 'auto',
                p: '1.5rem',
                '&::-webkit-scrollbar': { width: 8 },
                '&::-webkit-scrollbar-track': { background: 'transparent' },
                '&::-webkit-scrollbar-thumb': {
                    background: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '4px',
                },
            }}
        >
            {/* Scenes Grid */}
            {sceneItems.length > 0 && (
                <Box sx={sectionSx}>
                    <Box sx={sectionTitleSx}><FormattedMessage id="scenes" /></Box>
                    <Box sx={{ ...gridSx, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                        {sceneItems.map(s => {
                            const item = items.find(it => it.type === "scene" && it.id === s.id)!;
                            return renderCard(item, items.indexOf(item) === selectedIndex);
                        })}
                    </Box>
                </Box>
            )}

            {/* Performers Grid */}
            {performerItems.length > 0 && (
                <Box sx={sectionSx}>
                    <Box sx={sectionTitleSx}><FormattedMessage id="performers" /></Box>
                    <Box sx={gridSx}>
                        {performerItems.map(p => {
                            const item = items.find(it => it.type === "performer" && it.id === p.id)!;
                            return renderCard(item, items.indexOf(item) === selectedIndex);
                        })}
                    </Box>
                </Box>
            )}

            {/* Images Grid */}
            {imageItems.length > 0 && (
                <Box sx={sectionSx}>
                    <Box sx={sectionTitleSx}><FormattedMessage id="images" /></Box>
                    <Box sx={gridSx}>
                        {imageItems.map(i => {
                            const item = items.find(it => it.type === "image" && it.id === i.id)!;
                            return renderCard(item, items.indexOf(item) === selectedIndex);
                        })}
                    </Box>
                </Box>
            )}

            {/* Galleries Grid */}
            {galleryItems.length > 0 && (
                <Box sx={sectionSx}>
                    <Box sx={sectionTitleSx}><FormattedMessage id="galleries" /></Box>
                    <Box sx={gridSx}>
                        {galleryItems.map(g => {
                            const item = items.find(it => it.type === "gallery" && it.id === g.id)!;
                            return renderCard(item, items.indexOf(item) === selectedIndex);
                        })}
                    </Box>
                </Box>
            )}

            {/* Studios List */}
            {studioItems.length > 0 && (
                <Box sx={sectionSx}>
                    <Box sx={sectionTitleSx}><FormattedMessage id="studios" /></Box>
                    <Box sx={listGridSx}>
                        {studioItems.map(s => {
                            const item = items.find(it => it.type === "studio" && it.id === s.id)!;
                            return renderListItem(item, items.indexOf(item) === selectedIndex);
                        })}
                    </Box>
                </Box>
            )}

            {/* Tags List */}
            {tagItems.length > 0 && (
                <Box sx={sectionSx}>
                    <Box sx={sectionTitleSx}><FormattedMessage id="tags" /></Box>
                    <Box sx={listGridSx}>
                        {tagItems.map(t => {
                            const item = items.find(it => it.type === "tag" && it.id === t.id)!;
                            return renderListItem(item, items.indexOf(item) === selectedIndex);
                        })}
                    </Box>
                </Box>
            )}
        </Box>
    );
};
