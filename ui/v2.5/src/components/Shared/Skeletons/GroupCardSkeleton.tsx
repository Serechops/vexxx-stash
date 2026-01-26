import React from "react";
import { Box, Skeleton, Card } from "@mui/material";

interface IGroupCardSkeletonProps {
    width?: number;
}

export const GroupCardSkeleton: React.FC<IGroupCardSkeletonProps> = ({ width }) => {
    return (
        <Card
            sx={{
                width: width ?? "100%",
                bgcolor: "grey.900",
                borderRadius: 3,
                overflow: "hidden",
                position: "relative",
            }}
        >
            {/* Portrait Aspect 2:3 */}
            <Box sx={{ position: "relative", width: "100%", aspectRatio: "2/3" }}>
                <Skeleton 
                    variant="rectangular" 
                    width="100%" 
                    height="100%" 
                    sx={{ 
                        bgcolor: "grey.800",
                        transform: "none",
                    }} 
                />
                
                {/* Gradient Overlay */}
                <Box
                    sx={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: "50%",
                        background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
                    }}
                />
                
                {/* Content placeholders */}
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
                    <Skeleton 
                        variant="text" 
                        width="75%" 
                        height={28} 
                        sx={{ bgcolor: "rgba(255,255,255,0.1)" }} 
                    />
                    <Skeleton 
                        variant="text" 
                        width="50%" 
                        height={16} 
                        sx={{ bgcolor: "rgba(255,255,255,0.05)" }} 
                    />
                </Box>
            </Box>
        </Card>
    );
};
