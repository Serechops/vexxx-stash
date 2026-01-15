import React from "react";
import Grid from "@mui/material/Grid";
import Container, { ContainerProps } from "@mui/material/Container";
import { styled } from "@mui/material/styles";

// MUI v7: Grid is the standard Grid (v2) now? Or still v1.
// We will use standard Grid for now and adapt.

interface BContainerProps extends ContainerProps {
    fluid?: boolean;
}

export const BContainer: React.FC<BContainerProps> = (props) => {
    return <Container {...props} maxWidth={props.fluid ? false : props.maxWidth || "lg"} />;
};

export const Row: React.FC<React.ComponentProps<typeof Grid>> = (props) => {
    return <Grid container spacing={2} {...props} />;
};

// Bootstrap Col props: xs, sm, md, lg, xl (can be boolean or number)
// MUI Grid2 props: size={{ xs: ..., md: ... }} or just xs={...} if using the legacy-like API (refer to docs)
// Grid2 uses `size` prop or direct breakpoint props.

export const Col: React.FC<any> = ({ xs, sm, md, lg, xl, children, className, ...props }) => {
    // Map bootstrap cols to MUI Grid size
    // Bootstrap: <Col md={6}> -> MUI: <Grid size={{ md: 6 }}>
    const size = {
        xs,
        sm,
        md,
        lg,
        xl,
    };

    // Remove undefined keys
    Object.keys(size).forEach(key => (size as any)[key] === undefined && delete (size as any)[key]);

    return <Grid size={size} className={className} {...props}>{children}</Grid>;
};
