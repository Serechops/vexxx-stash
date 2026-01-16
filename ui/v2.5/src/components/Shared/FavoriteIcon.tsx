import React from "react";
import { IconButton } from "@mui/material";
import FavoriteIconMui from "@mui/icons-material/Favorite";
import cx from "classnames";

export const FavoriteIcon: React.FC<{
  favorite: boolean;
  onToggleFavorite: (v: boolean) => void;
  size?: "small" | "medium" | "large" | "1x" | "2x";
  className?: string;
}> = ({ favorite, onToggleFavorite, size = "small", className }) => {
  // map legacy font-awesome sizes to MUI fontSize values
  const fontSize: "small" | "medium" | "large" =
    size === "1x" ? "small" : size === "2x" ? "large" : (size as any);

  const buttonSize: "small" | "medium" = fontSize === "small" ? "small" : "medium";

  return (
    <IconButton
      className={cx(
        "minimal",
        "mousetrap",
        "favorite-button",
        className,
        favorite ? "favorite" : "not-favorite"
      )}
      onClick={() => onToggleFavorite!(!favorite)}
      size={buttonSize}
    >
      <FavoriteIconMui fontSize={fontSize} />
    </IconButton>
  );
};
