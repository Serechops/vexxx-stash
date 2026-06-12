import React, { useEffect, useState } from "react";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";
import { useConfigurationContextOptional } from "src/hooks/Config";
import { IUIConfig } from "src/core/config";
import { SFWHeroPlaceholder } from "src/components/Shared/SFWHeroPlaceholder";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";

const scrollLeft = keyframes`
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
`;

const scrollRight = keyframes`
  from { transform: translateX(-50%); }
  to   { transform: translateX(0); }
`;

/**
 * Hero for the Galleries listing page.
 * Three rows of sharp cover images drifting at different speeds — no blur.
 */
export const GalleriesHero: React.FC = () => {
    const history = useHistory();
    const [activeIndex, setActiveIndex] = useState(0);
    const { configuration } = useConfigurationContextOptional() || {};

    const { data, loading } = GQL.useFindGalleriesQuery({
        variables: {
            filter: { per_page: 15, sort: "random" },
        },
        fetchPolicy: "no-cache",
    });

    const galleries = (data?.findGalleries?.galleries || []).filter((g) => g.paths?.cover);

    useEffect(() => {
        if (galleries.length === 0) return;
        const id = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % galleries.length);
        }, 8000);
        return () => clearInterval(id);
    }, [galleries.length]);

    const uiConfig = configuration?.ui as IUIConfig | undefined;
    if (configuration?.interface?.sfwContentMode && (uiConfig?.sfwBlurGalleries ?? true))
        return <SFWHeroPlaceholder />;
    if (loading || galleries.length === 0) return null;

    const rowDefs = [
        { start: 0,  direction: "left"  as const, speed: "62s", top: "7%",  height: "22vh" },
        { start: 5,  direction: "right" as const, speed: "88s", top: "38%", height: "20vh" },
        { start: 10, direction: "left"  as const, speed: "50s", top: "68%", height: "22vh" },
    ];

    const rows = rowDefs
        .map((def) => ({ ...def, items: galleries.slice(def.start, def.start + 5) }))
        .filter((r) => r.items.length > 0);

    return (
        <Box
            sx={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                zIndex: 0,
                bgcolor: "#080808",
                overflow: "hidden",
                display: { xs: "none", md: "block" },
            }}
        >
            {rows.map((row, ri) => {
                const looped = [...row.items, ...row.items];
                return (
                    <Box
                        key={ri}
                        sx={{
                            position: "absolute",
                            top: row.top,
                            left: 0,
                            display: "flex",
                            gap: "10px",
                            animation: `${row.direction === "left" ? scrollLeft : scrollRight} ${row.speed} linear infinite`,
                            willChange: "transform",
                        }}
                    >
                        {looped.map((gallery, i) => {
                            const globalIndex = row.start + (i % row.items.length);
                            const isActive = globalIndex === activeIndex;

                            return (
                                <Box
                                    key={`${ri}-${i}-${gallery.id}`}
                                    onClick={() => history.push(`/galleries/${gallery.id}`)}
                                    sx={{
                                        position: "relative",
                                        height: row.height,
                                        aspectRatio: "4/3",
                                        flexShrink: 0,
                                        overflow: "hidden",
                                        cursor: "pointer",
                                        borderRadius: "2px",
                                        outline: isActive ? "2px solid" : "2px solid transparent",
                                        outlineColor: isActive ? "primary.main" : "transparent",
                                        outlineOffset: "3px",
                                        transition: "outline-color 0.5s ease",
                                    }}
                                >
                                    <Box
                                        component="img"
                                        src={gallery.paths?.cover || ""}
                                        alt=""
                                        sx={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                            display: "block",
                                        }}
                                    />
                                    {/* Dark tint — removed on active item */}
                                    <Box
                                        sx={{
                                            position: "absolute",
                                            inset: 0,
                                            bgcolor: "rgba(0,0,0,0.68)",
                                            opacity: isActive ? 0 : 1,
                                            transition: "opacity 0.5s ease",
                                            pointerEvents: "none",
                                        }}
                                    />
                                </Box>
                            );
                        })}
                    </Box>
                );
            })}

            {/* Top fade */}
            <Box
                sx={{
                    position: "absolute",
                    top: 0, left: 0, right: 0,
                    height: "40%",
                    background: "linear-gradient(to bottom, #080808 0%, rgba(8,8,8,0.75) 55%, transparent 100%)",
                    zIndex: 10,
                    pointerEvents: "none",
                }}
            />
            {/* Bottom fade */}
            <Box
                sx={{
                    position: "absolute",
                    bottom: 0, left: 0, right: 0,
                    height: "65%",
                    background: "linear-gradient(to top, #080808 30%, rgba(8,8,8,0.65) 65%, transparent 100%)",
                    zIndex: 10,
                    pointerEvents: "none",
                }}
            />
            {/* Side fades */}
            <Box
                sx={{
                    position: "absolute",
                    top: 0, bottom: 0, left: 0,
                    width: "10%",
                    background: "linear-gradient(to right, #080808, transparent)",
                    zIndex: 10,
                    pointerEvents: "none",
                }}
            />
            <Box
                sx={{
                    position: "absolute",
                    top: 0, bottom: 0, right: 0,
                    width: "10%",
                    background: "linear-gradient(to left, #080808, transparent)",
                    zIndex: 10,
                    pointerEvents: "none",
                }}
            />
        </Box>
    );
};
