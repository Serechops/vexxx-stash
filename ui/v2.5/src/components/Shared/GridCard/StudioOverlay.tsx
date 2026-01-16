import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useConfigurationContext } from "src/hooks/Config";
import { Box } from "@mui/material";

interface IStudio {
  id: string;
  name: string;
  image_path?: string | null;
}

export const StudioOverlay: React.FC<{
  studio: IStudio | null | undefined;
}> = ({ studio }) => {
  const { configuration } = useConfigurationContext();

  const configValue = configuration?.interface.showStudioAsText;

  const showStudioAsText = useMemo(() => {
    if (configValue || !studio?.image_path) {
      return true;
    }

    // If the studio has a default image, show the studio name as text
    const studioImageURL = new URL(studio.image_path);
    if (studioImageURL.searchParams.get("default") === "true") {
      return true;
    }

    return false;
  }, [configValue, studio?.image_path]);

  if (!studio) return <></>;

  return (
    <Box
      className="stash-studio-overlay"
      sx={{
        display: "block",
        fontWeight: 900,
        height: "10%",
        maxWidth: "40%",
        opacity: 0.75,
        position: "absolute",
        right: "0.7rem",
        top: "0.7rem",
        transition: "opacity 0.5s",
        zIndex: 8,
        "& a": {
          color: "text.primary",
          display: "inline-block",
          letterSpacing: "-0.03rem",
          textAlign: "right",
          textDecoration: "none",
          textShadow: "0 0 3px #000",
        },
      }}
    >
      <Link to={`/studios/${studio.id}`}>
        {showStudioAsText ? (
          studio.name
        ) : (
          <Box
            component="img"
            loading="lazy"
            alt={studio.name}
            src={studio.image_path ?? ""}
            sx={{
              height: 50,
              objectFit: "contain",
              width: "100%",
            }}
          />
        )}
      </Link>
    </Box>
  );
};
