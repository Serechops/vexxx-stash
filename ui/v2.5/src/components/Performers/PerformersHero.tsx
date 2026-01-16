import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";
import { Box } from "@mui/material";

/**
 * Hero banner for the main Performers listing page.
 * Displays a 3D carousel of random performers.
 */
export const PerformersHero: React.FC = () => {
    const history = useHistory();

    // Fetch 1 random performer
    const { data, loading } = GQL.useFindPerformersQuery({
        variables: {
            filter: {
                per_page: 1,
                sort: "random",
            },
        },
    });

    const performer = data?.findPerformers?.performers?.[0];

    if (loading || !performer) return null;

    const handlePerformerClick = () => {
        history.push(`/performers/${performer.id}`);
    };

    const imagePath = performer.image_path || "";

    // Stats helpers
    const getAge = (birthdate?: string | null) => {
        if (!birthdate) return null;
        const birth = new Date(birthdate);
        const now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        const m = now.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    };

    const age = getAge(performer.birthdate);

    return (
        <Box sx={{ display: { xs: 'none', '@media (min-width: 950px)': { display: 'block' } } }}>
            <div className="fixed top-0 left-0 w-screen h-[56.25vw] md:h-screen z-0 overflow-hidden bg-[#000]">
                {/* Blurred Background */}
                <div
                    className="absolute inset-0 bg-cover bg-center transition-all duration-[2000ms] ease-out opacity-60 scale-105"
                    style={{
                        backgroundImage: `url('${imagePath}')`,
                        filter: "blur(40px) brightness(0.3)",
                    }}
                />

                {/* Gradient Overlays */}
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />

                {/* Content Container */}
                <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center p-6 md:p-16 pb-24 md:pb-32">
                    <div className="max-w-7xl w-full flex flex-row items-end gap-12 z-10">

                        {/* Left Column: Portrait */}
                        <div
                            className="flex-shrink-0 w-[280px] lg:w-[360px] aspect-[2/3] rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden cursor-pointer transition-transform duration-500 hover:scale-105"
                            onClick={handlePerformerClick}
                        >
                            <img
                                src={imagePath}
                                alt={performer.name || ""}
                                className="w-full h-full object-cover"
                            />
                        </div>

                        {/* Right Column: Magazine Spread Stats */}
                        <div className="flex-grow flex flex-col items-start justify-end pb-4">
                            {/* Nationality / Country */}
                            {performer.country && (
                                <div className="text-white/60 font-bold tracking-[0.2em] uppercase text-sm mb-2 flex items-center gap-2">
                                    {performer.country}
                                </div>
                            )}

                            {/* Name */}
                            <h1
                                className="text-7xl lg:text-9xl font-black text-white mb-8 leading-none tracking-tighter drop-shadow-2xl cursor-pointer hover:text-primary transition-colors duration-300"
                                onClick={handlePerformerClick}
                            >
                                {performer.name}
                            </h1>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-3 gap-8 md:gap-16 border-t border-white/20 pt-8 w-full max-w-3xl">
                                {/* Stat 1: Appearances */}
                                <div>
                                    <div className="text-4xl font-bold text-white mb-1">
                                        {performer.scene_count || 0}
                                    </div>
                                    <div className="text-xs font-bold text-gray-400 tracking-widest uppercase">
                                        Scenes
                                    </div>
                                </div>

                                {/* Stat 2: Age / Birthdate */}
                                {age !== null && (
                                    <div>
                                        <div className="text-4xl font-bold text-white mb-1">
                                            {age} <span className="text-xl text-white/50 font-normal">y.o.</span>
                                        </div>
                                        <div className="text-xs font-bold text-gray-400 tracking-widest uppercase">
                                            {performer.birthdate}
                                        </div>
                                    </div>
                                )}

                                {/* Stat 3: Height */}
                                {performer.weight && (
                                    <div>
                                        <div className="text-4xl font-bold text-white mb-1">
                                            {performer.weight} <span className="text-xl text-white/50 font-normal">cm</span>
                                        </div>
                                        <div className="text-xs font-bold text-gray-400 tracking-widest uppercase">
                                            Height
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Box>
    );
};
