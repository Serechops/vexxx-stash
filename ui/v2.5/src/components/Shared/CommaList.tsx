import React from "react";
import { Box, BoxProps } from "@mui/material";

interface ICommaListProps extends BoxProps {
    children: React.ReactNode;
}

export const CommaList: React.FC<ICommaListProps> = ({ children, sx, ...props }) => {
    return (
        <Box
            component="ul"
            sx={{
                listStyle: "none",
                p: 0,
                m: 0,
                ...sx,
            }}
            {...props}
        >
            {React.Children.map(children, (child) => {
                if (!React.isValidElement(child)) return child;
                return React.cloneElement(child as React.ReactElement, {
                    style: { display: "inline" }, // fallback if not MUI
                    sx: {
                        display: "inline",
                        "&:not(:last-child)::after": {
                            content: '", "',
                            whiteSpace: "pre",
                        },
                        ...(child.props as any).sx,
                    },
                });
            })}
        </Box>
    );
};

export const NewlineList: React.FC<ICommaListProps> = ({ children, sx, ...props }) => {
    return (
        <Box
            component="ul"
            sx={{
                listStyle: "none",
                p: 0,
                m: 0,
                ...sx,
            }}
            {...props}
        >
            {children}
        </Box>
    );
};
