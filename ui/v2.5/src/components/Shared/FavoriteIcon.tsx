import React from "react";
import { Icon } from "../Shared/Icon";
import { IconButton } from "@mui/material";
import { faHeart } from "@fortawesome/free-solid-svg-icons";
import cx from "classnames";
import { SizeProp } from "@fortawesome/fontawesome-svg-core";

export const FavoriteIcon: React.FC<{
  favorite: boolean;
  onToggleFavorite: (v: boolean) => void;
  size?: SizeProp;
  className?: string;
}> = ({ favorite, onToggleFavorite, size, className }) => {
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
      size="small"
    >
      <Icon icon={faHeart} size={size} />
    </IconButton>
  );
};
