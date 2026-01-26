import React from "react";
import { Box, Skeleton, Card, CardContent } from "@mui/material";

interface IStudioCardSkeletonProps {
    width?: number;
}

export const StudioCardSkeleton: React.FC<IStudioCardSkeletonProps> = ({ width }) => {
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
            {/* Studio Banner - 2:1 Aspect */}
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
                {/* Center logo placeholder */}
                <Box
                    sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                    }}
                >
                    <Skeleton 
                        variant="circular" 
                        width={64} 
                        height={64} 
                        sx={{ bgcolor: "grey.700" }} 
                    />
                </Box>
            </Box>

            {/* Content */}
            <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Skeleton variant="text" width="50%" height={24} sx={{ bgcolor: "grey.700", mb: 1 }} />
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    <Skeleton variant="text" width="75%" height={16} sx={{ bgcolor: "grey.800" }} />
                    <Skeleton variant="text" width="40%" height={16} sx={{ bgcolor: "grey.800" }} />
                </Box>
            </CardContent>
        </Card>
    );
};
