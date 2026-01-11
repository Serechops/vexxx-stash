import React, { useEffect, useRef } from "react";
import { Link, useHistory } from "react-router-dom";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import styles from "./GlobalSearch.module.scss";
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
            <div className={styles.inputWrapper}>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>
                    <FormattedMessage id="no_results" defaultMessage="No results found" />
                </span>
            </div>
        );
    }

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
                    <div
                        key={item.id}
                        className={cx(styles.cardWrapper, { [styles.active]: isActive })}
                        ref={isActive ? activeItemRef as any : null}
                        onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
                        onClick={(e) => {
                            // Cards utilize internal links/history pushes, but we want to intercept properly or let them handle it.
                            // Most cards handle clicks on cover.
                            // For keyboard nav 'Enter' support in GlobalSearch.tsx, we rely on the component there finding the active element.
                            if (!e.defaultPrevented) {
                                onSelect();
                            }
                        }}
                    >
                        <SceneCard scene={item.data} {...commonProps} />
                    </div>
                );
            case "performer":
                return (
                    <div
                        key={item.id}
                        className={cx(styles.cardWrapper, { [styles.active]: isActive })}
                        ref={isActive ? activeItemRef as any : null}
                        onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
                        onClick={() => onSelect()}
                    >
                        <PerformerCard performer={item.data} {...commonProps} />
                    </div>
                );
            case "image":
                return (
                    <div
                        key={item.id}
                        className={cx(styles.cardWrapper, { [styles.active]: isActive })}
                        ref={isActive ? activeItemRef as any : null}
                        onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
                        onClick={() => onSelect()}
                    >
                        <ImageCard image={item.data} {...commonProps} />
                    </div>
                );
            case "gallery":
                return (
                    <div
                        key={item.id}
                        className={cx(styles.cardWrapper, { [styles.active]: isActive })}
                        ref={isActive ? activeItemRef as any : null}
                        onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
                        onClick={() => onSelect()}
                    >
                        <GalleryCard gallery={item.data} {...commonProps} />
                    </div>
                );
            default:
                // Handled in renderListItem
                return null;
        }
    };

    const renderListItem = (item: FlatResultItem, isActive: boolean) => {
        return (
            <Link
                key={item.id}
                to={item.url}
                className={cx(styles.listItem, { [styles.active]: isActive })}
                onClick={onSelect}
                ref={isActive ? activeItemRef as any : null}
                onMouseEnter={() => setSelectedIndex(items.indexOf(item))}
            >
                {item.data.image_path ? (
                    <img src={item.data.image_path} alt="" className={styles.listItemImage} />
                ) : (
                    <div className={styles.listItemImage} />
                )}
                <div className={styles.itemContent}>
                    <div className={styles.title}>{item.data.name}</div>
                </div>
            </Link>
        );
    }

    return (
        <div className={styles.results}>
            {/* Scenes Grid */}
            {sceneItems.length > 0 && (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}><FormattedMessage id="scenes" /></div>
                    <div className={cx(styles.grid, styles.scenes)}>
                        {sceneItems.map(s => {
                            const item = items.find(it => it.type === "scene" && it.id === s.id)!;
                            return renderCard(item, items.indexOf(item) === selectedIndex);
                        })}
                    </div>
                </div>
            )}

            {/* Performers Grid */}
            {performerItems.length > 0 && (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}><FormattedMessage id="performers" /></div>
                    <div className={styles.grid}>
                        {performerItems.map(p => {
                            const item = items.find(it => it.type === "performer" && it.id === p.id)!;
                            return renderCard(item, items.indexOf(item) === selectedIndex);
                        })}
                    </div>
                </div>
            )}

            {/* Images Grid */}
            {imageItems.length > 0 && (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}><FormattedMessage id="images" /></div>
                    <div className={styles.grid}>
                        {imageItems.map(i => {
                            const item = items.find(it => it.type === "image" && it.id === i.id)!;
                            return renderCard(item, items.indexOf(item) === selectedIndex);
                        })}
                    </div>
                </div>
            )}

            {/* Galleries Grid */}
            {galleryItems.length > 0 && (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}><FormattedMessage id="galleries" /></div>
                    <div className={styles.grid}>
                        {galleryItems.map(g => {
                            const item = items.find(it => it.type === "gallery" && it.id === g.id)!;
                            return renderCard(item, items.indexOf(item) === selectedIndex);
                        })}
                    </div>
                </div>
            )}

            {/* Studios List */}
            {studioItems.length > 0 && (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}><FormattedMessage id="studios" /></div>
                    <div className={styles.listGrid}>
                        {studioItems.map(s => {
                            const item = items.find(it => it.type === "studio" && it.id === s.id)!;
                            return renderListItem(item, items.indexOf(item) === selectedIndex);
                        })}
                    </div>
                </div>
            )}

            {/* Tags List */}
            {tagItems.length > 0 && (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}><FormattedMessage id="tags" /></div>
                    <div className={styles.listGrid}>
                        {tagItems.map(t => {
                            const item = items.find(it => it.type === "tag" && it.id === t.id)!;
                            return renderListItem(item, items.indexOf(item) === selectedIndex);
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
