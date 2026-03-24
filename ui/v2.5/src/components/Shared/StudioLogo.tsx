import React from "react";
import { Link } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { faVideo } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "./Icon";

interface IProps {
  studio: {
    id: string;
    name: string;
    image_path?: string | null;
  };
  showStudioText?: boolean;
}

export const StudioLogo: React.FC<IProps> = ({ studio, showStudioText }) => {
  return (
    <Box
      className="studio-logo"
      component={Link as React.ElementType}
      to={`/studios/${studio.id}`}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "inherit",
        textDecoration: "none",
        "&:hover": { color: "inherit" },
      }}
    >
      {studio.image_path && !showStudioText ? (
        <Box
          component="img"
          src={studio.image_path}
          alt={`${studio.name} logo`}
          sx={{
            maxHeight: "8rem",
            maxWidth: "100%",
            mt: { lg: "1rem" },
          }}
        />
      ) : (
        <>
          <Icon icon={faVideo} />
          <Typography component="span" sx={{ ml: 1 }}>
            {studio.name}
          </Typography>
        </>
      )}
    </Box>
  );
};

export default StudioLogo;
