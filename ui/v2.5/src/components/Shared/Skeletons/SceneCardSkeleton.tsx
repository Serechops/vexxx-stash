import React from "react";
import { Box, Skeleton, Card, CardContent } from "@mui/material";

export const SceneCardSkeleton: React.FC<{ width?: number }> = ({ width }) => {
    return (
        <Card
            sx={{
                width: width ?? "100%",
                bgcolor: "background.paper",
                borderRadius: 2,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                height: "100%",
            }}
        >
            {/* Image Aspect Ratio Placeholder */}
            <Box sx={{ position: "relative", width: "100%", aspectRatio: "16/9" }}>
                <Skeleton 
                    variant="rectangular" 
                    width="100%" 
                    height="100%" 
                    sx={{ 
                        bgcolor: "grey.800",
                        transform: "none",
                    }} 
                />
                {/* Duration badge placeholder */}
                <Box
                    sx={{
                        position: "absolute",
                        bottom: 8,
                        right: 8,
                    }}
                >
                    <Skeleton 
                        variant="rounded" 
                        width={48} 
                        height={20} 
                        sx={{ bgcolor: "grey.700" }} 
                    />
                </Box>
                {/* Resolution badge placeholder */}
                <Box
                    sx={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                    }}
                >
                    <Skeleton 
                        variant="rounded" 
                        width={32} 
                        height={16} 
                        sx={{ bgcolor: "grey.700" }} 
                    />
                </Box>
            </Box>

            {/* Content Placeholder */}
            <CardContent 
                sx={{ 
                    p: 1.5, 
                    display: "flex", 
                    flexDirection: "column", 
                    gap: 1,
                    flexGrow: 1,
                    "&:last-child": { pb: 1.5 },
                }}
            >
                {/* Studio / Date Row */}
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Skeleton variant="text" width="35%" height={16} sx={{ bgcolor: "grey.800" }} />
                    <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Skeleton variant="rounded" width={24} height={16} sx={{ bgcolor: "grey.800" }} />
                        <Skeleton variant="rounded" width={24} height={16} sx={{ bgcolor: "grey.800" }} />
                    </Box>
                </Box>

                {/* Title */}
                <Skeleton variant="text" width="85%" height={22} sx={{ bgcolor: "grey.700" }} />

                {/* Performers / Tags */}
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: "auto" }}>
                    <Skeleton variant="rounded" width={60} height={20} sx={{ bgcolor: "grey.800", borderRadius: 1 }} />
                    <Skeleton variant="rounded" width={45} height={20} sx={{ bgcolor: "grey.800", borderRadius: 1 }} />
                </Box>
            </CardContent>
        </Card>
    );
};
