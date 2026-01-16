import React, { useEffect, useState } from "react";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { useHistory } from "react-router-dom";

export const GroupsHero: React.FC = () => {
    const [activeIndex, setActiveIndex] = useState(0);
    const history = useHistory();

    // Fetch random groups
    const { data, loading } = GQL.useFindGroupsQuery({
        variables: {
            filter: {
                per_page: 50,
                sort: "random",
            },
        },
    });

    const groups = (data?.findGroups?.groups || [])
        .filter(g => g.front_image_path)
        .slice(0, 20);

    // Auto-advance
    useEffect(() => {
        if (groups.length === 0) return;
        const interval = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % groups.length);
        }, 3000); // 3 seconds
        return () => clearInterval(interval);
    }, [groups.length]);

    if (loading || groups.length === 0) return null;

    const getStyle = (index: number) => {
        const length = groups.length;
        let diff = (index - activeIndex + length) % length;
        if (diff > length / 2) diff -= length;

        const absDiff = Math.abs(diff);
        const isActive = diff === 0;

        // Hide items too far away
        if (absDiff > 3) return { display: 'none' };

        // Config
        const spread = 20; // Spacing percentage
        const left = 50 + (diff * spread);
        const zIndex = 50 - absDiff;

        // Active item scale
        const scale = isActive ? 2.8 : 3.6;
        const opacity = isActive ? 1 : 0.4;

        // 3D transform for depth
        const translateZ = isActive ? 100 : 0;

        return {
            left: `${left}%`,
            zIndex,
            opacity,
            transform: `translateX(-50%) translateZ(${translateZ}px) scale(${scale})`,
        };
    };

    const handleGroupClick = (id: string) => {
        history.push(`/groups/${id}`);
    };

    return (
        <div className="hidden md:flex relative w-full h-[40vh] overflow-hidden bg-[#111113] select-none items-center justify-center perspective-1000 mb-6">
            {/* Background Gradients */}
            <div className="absolute inset-0 bg-gradient-radial from-[#1a0a2e]/30 to-[#111113] opacity-50 z-0 pointer-events-none" />

            <div className="relative w-full h-full flex items-center justify-center preserve-3d">
                {groups.map((group, index) => {
                    const style = getStyle(index);
                    if (style.display === 'none') return null;

                    const isActive = style.zIndex === 50;
                    const imagePath = group.front_image_path || "";

                    return (
                        <div
                            key={group.id}
                            className={cx(
                                "absolute top -translate-y-1/2 transition-all duration-1000 ease-in-out cursor-pointer group",
                                "w-[140px] h-[210px] rounded-lg overflow-hidden shadow-2xl bg-gray-900",
                                isActive ? "w-[180px] h-[270px] z-50 brightness-110" : "grayscale-[30%]"
                            )}
                            style={style}
                            onClick={() => handleGroupClick(group.id)}
                        >
                            <img
                                src={imagePath}
                                alt={group.name || ""}
                                className="w-full h-full object-cover transition-transform duration-1000"
                            />

                            {/* Overlay Gradient (cinematic blue/purple) */}
                            <div className="absolute inset-0 bg-gradient-to-br from-[#0d1f82cc] to-[#5c085ccc] mix-blend-multiply opacity-0 transition-opacity duration-500" />

                            {/* Active Overlay */}
                            {isActive && (
                                <div className="absolute inset-0 bg-black/10 transition-opacity duration-1000" />
                            )}

                        </div>
                    );
                })}
            </div>
        </div>
    );
};
