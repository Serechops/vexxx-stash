import React from "react";
import { Skeleton, Card } from "@mui/material";

interface IImageCardSkeletonProps {
    width?: number;
}

export const ImageCardSkeleton: React.FC<IImageCardSkeletonProps> = ({ width }) => {
    return (
        <Card
            sx={{
                width: width ?? "100%",
                bgcolor: "grey.900",
                borderRadius: 2,
                overflow: "hidden",
                position: "relative",
                aspectRatio: "4/3",
            }}
        >
            <Skeleton 
                variant="rectangular" 
                width="100%" 
                height="100%" 
                sx={{ 
                    bgcolor: "grey.800",
                    position: "absolute",
                    inset: 0,
                    transform: "none",
                }} 
            />
        </Card>
    );
};
