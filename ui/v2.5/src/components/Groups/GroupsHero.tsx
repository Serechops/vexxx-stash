import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";
import { Box, Typography, Button } from "@mui/material";
import { Play } from "lucide-react";

export const GroupsHero: React.FC = () => {
    const history = useHistory();
    const [activeIndex, setActiveIndex] = useState(0);
    const [fadeIn, setFadeIn] = useState(true);

    // Fetch random groups
    const { data, loading } = GQL.useFindGroupsQuery({
        variables: {
            filter: {
                per_page: 8,
                sort: "random",
            },
        },
    });

    const groups = (data?.findGroups?.groups || []).filter(g => g.front_image_path);

    // Auto-advance
    useEffect(() => {
        if (groups.length === 0) return;
        const interval = setInterval(() => {
            setFadeIn(false); // Trigger fade out
            setTimeout(() => {
                setActiveIndex((prev) => (prev + 1) % groups.length);
                setFadeIn(true); // Trigger fade in
            }, 600); // 600ms match transition time
        }, 8000); // 8 seconds per group
        return () => clearInterval(interval);
    }, [groups.length]);

    if (loading || groups.length === 0) return null;

    const group = groups[activeIndex];

    const handleGroupClick = () => {
        history.push(`/groups/${group.id}`);
    };

    const frontImage = group.front_image_path || "";
    const backImage = (group as any).back_image_path;

    return (
        <Box sx={{ display: { xs: 'none', '@media (min-width: 950px)': { display: 'block' } } }}>
            <div className="fixed top-0 left-0 w-screen h-[56.25vw] md:h-screen z-0 overflow-hidden bg-[#000]">
                {/* Blurred Background */}
                <div
                    className={cx(
                        "absolute inset-0 bg-cover bg-center transition-all duration-[1500ms] ease-in-out",
                        fadeIn ? "opacity-100 scale-105" : "opacity-0 scale-100"
                    )}
                    style={{
                        backgroundImage: `url('${backImage || frontImage}')`,
                        filter: "blur(20px) brightness(0.4)",
                    }}
                />

                {/* Gradient Overlays for depth */}
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />

                {/* Split Layout Container */}
                <div className={cx(
                    "absolute top-0 left-0 w-full h-full flex items-center justify-center p-6 md:p-16 pb-24 md:pb-32 transition-all duration-1000 ease-in-out",
                    fadeIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                )}>
                    <div className="max-w-7xl w-full flex flex-col md:flex-row items-end md:items-center gap-8 md:gap-16">

                        {/* Left Column: Covers */}
                        <div className="flex-shrink-0 flex gap-4 md:gap-8 relative z-10 hidden md:flex items-end">
                            {/* Back Cover (if exists) */}
                            {backImage && (
                                <div className="w-[280px] lg:w-[360px] aspect-[2/3] rounded-lg shadow-2xl overflow-hidden transition-transform duration-500 hover:scale-105">
                                    <img
                                        src={backImage}
                                        alt="Back Cover"
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            )}

                            {/* Front Cover */}
                            <div className="w-[280px] lg:w-[360px] aspect-[2/3] rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden transition-transform duration-500 hover:scale-105 z-20">
                                <img
                                    src={frontImage}
                                    alt="Front Cover"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        </div>

                        {/* Right Column: Metadata */}
                        <div className="flex-grow flex flex-col items-start justify-center text-left">
                            {/* Metadata Pill */}
                            <div className="flex items-center gap-3 mb-4">
                                {group.studio && (
                                    <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
                                        {group.studio.image_path && (
                                            <img
                                                src={group.studio.image_path}
                                                alt={group.studio.name}
                                                className="h-5 w-auto object-contain"
                                            />
                                        )}
                                        <span className="text-xs font-bold text-white uppercase tracking-wider">
                                            {group.studio.name}
                                        </span>
                                    </div>
                                )}
                                {group.date && (
                                    <span className="text-sm font-medium text-gray-300 bg-black/30 px-2 py-1 rounded-md">
                                        {group.date}
                                    </span>
                                )}
                            </div>

                            {/* Title */}
                            <Typography
                                variant="h1"
                                component="h1"
                                className="font-bold text-white mb-6 leading-none tracking-tight drop-shadow-2xl"
                                sx={{
                                    fontSize: { xs: "2rem", md: "4.5rem", lg: "6rem" },
                                    fontWeight: 900,
                                }}
                            >
                                {group.name}
                            </Typography>

                            {/* Description */}
                            {group.synopsis && (
                                <Typography
                                    variant="body1"
                                    className="text-gray-200 mb-8 line-clamp-3 md:line-clamp-4 max-w-2xl text-sm md:text-xl leading-relaxed drop-shadow-md font-light"
                                >
                                    {group.synopsis}
                                </Typography>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-4">
                                <Button
                                    variant="contained"
                                    size="large"
                                    color="primary"
                                    startIcon={<Play size={24} fill="currentColor" />}
                                    onClick={handleGroupClick}
                                    sx={{
                                        borderRadius: "12px",
                                        px: 5,
                                        py: 1.5,
                                        fontSize: "1.2rem",
                                        fontWeight: 700,
                                        textTransform: "none",
                                        boxShadow: "0 4px 14px 0 rgba(0,0,0,0.39)",
                                    }}
                                >
                                    View Group
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Box>
    );
};
