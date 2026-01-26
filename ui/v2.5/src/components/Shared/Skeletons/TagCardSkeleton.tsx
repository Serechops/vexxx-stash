import React from "react";
import { Box, Skeleton, Card, CardContent } from "@mui/material";

interface ITagCardSkeletonProps {
    width?: number;
}

export const TagCardSkeleton: React.FC<ITagCardSkeletonProps> = ({ width }) => {
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
            {/* Tag Image - 2:1 Aspect */}
            <Box sx={{ position: "relative", width: "100%", aspectRatio: "2/1" }}>
                <Skeleton 
                    variant="rectangular" 
                    width="100%" 
                    height="100%" 
                    sx={{ 
                        bgcolor: "grey.800",
                        transform: "none",
                    }} 
                />
                {/* Center icon placeholder */}
                <Box
                    sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                    }}
                >
                    <Skeleton 
                        variant="rounded" 
                        width={48} 
                        height={48} 
                        sx={{ bgcolor: "grey.700" }} 
                    />
                </Box>
            </Box>

            {/* Content */}
            <CardContent sx={{ p: 1.5, minHeight: 80, "&:last-child": { pb: 1.5 } }}>
                <Skeleton variant="text" width="50%" height={24} sx={{ bgcolor: "grey.700", mb: 1 }} />
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    <Skeleton variant="text" width="100%" height={14} sx={{ bgcolor: "grey.800" }} />
                    <Skeleton variant="text" width="75%" height={14} sx={{ bgcolor: "grey.800" }} />
                </Box>
            </CardContent>
        </Card>
    );
};
