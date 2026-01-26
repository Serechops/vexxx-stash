import React from "react";
import { Box, Skeleton, Card } from "@mui/material";

export const PerformerCardSkeleton: React.FC<{ width?: number }> = ({ width }) => {
    return (
        <Card
            sx={{
                width: width ?? "100%",
                position: "relative",
                borderRadius: 3,
                overflow: "hidden",
                bgcolor: "grey.900",
                border: "none",
            }}
        >
            {/* Portrait Image Placeholder */}
            <Box sx={{ width: "100%", aspectRatio: "2/3", position: "relative" }}>
                <Skeleton 
                    variant="rectangular" 
                    width="100%" 
                    height="100%" 
                    sx={{ 
                        bgcolor: "grey.800",
                        transform: "none",
                    }} 
                />
                
                {/* Favorite icon placeholder */}
                <Box
                    sx={{
                        position: "absolute",
                        top: 12,
                        right: 12,
                    }}
                >
                    <Skeleton 
                        variant="circular" 
                        width={28} 
                        height={28} 
                        sx={{ bgcolor: "grey.700" }} 
                    />
                </Box>

                {/* Rating placeholder */}
                <Box
                    sx={{
                        position: "absolute",
                        top: 12,
                        left: 12,
                    }}
                >
                    <Skeleton 
                        variant="rounded" 
                        width={40} 
                        height={20} 
                        sx={{ bgcolor: "grey.700" }} 
                    />
                </Box>

                {/* Gradient Overlay */}
                <Box
                    sx={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        width: "100%",
                        height: "50%",
                        background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
                    }}
                />

                {/* Name and meta placeholders */}
                <Box
                    sx={{
                        position: "absolute",
                        bottom: 12,
                        left: 12,
                        right: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 1,
                    }}
                >
                    {/* Name */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Skeleton 
                            variant="text" 
                            width="65%" 
                            height={24} 
                            sx={{ bgcolor: "rgba(255,255,255,0.1)" }} 
                        />
                        {/* Country flag placeholder */}
                        <Skeleton 
                            variant="rounded" 
                            width={20} 
                            height={14} 
                            sx={{ bgcolor: "rgba(255,255,255,0.1)" }} 
                        />
                    </Box>
                    {/* Meta info (age, scene count) */}
                    <Skeleton 
                        variant="text" 
                        width="40%" 
                        height={16} 
                        sx={{ bgcolor: "rgba(255,255,255,0.05)" }} 
                    />
                </Box>
            </Box>
        </Card>
    );
};
