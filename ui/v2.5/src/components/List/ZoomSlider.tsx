import React, { useEffect } from "react";
import Mousetrap from "mousetrap";
import { Slider } from "@mui/material";

const minZoom = 0;
const maxZoom = 4;

export function useZoomKeybinds(props: {
  zoomIndex: number | undefined;
  onChangeZoom: (v: number) => void;
}) {
  const { zoomIndex, onChangeZoom } = props;
  useEffect(() => {
    Mousetrap.bind("+", () => {
      if (zoomIndex !== undefined && zoomIndex < maxZoom) {
        onChangeZoom(zoomIndex + 1);
      }
    });
    Mousetrap.bind("-", () => {
      if (zoomIndex !== undefined && zoomIndex > minZoom) {
        onChangeZoom(zoomIndex - 1);
      }
    });

    return () => {
      Mousetrap.unbind("+");
      Mousetrap.unbind("-");
    };
  });
}

export interface IZoomSelectProps {
  zoomIndex: number;
  onChangeZoom: (v: number) => void;
}

export const ZoomSelect: React.FC<IZoomSelectProps> = ({
  zoomIndex,
  onChangeZoom,
}) => {
  return (
    <Slider
      min={minZoom}
      max={maxZoom}
      value={zoomIndex}
      onChange={(_, value) => {
        onChangeZoom(value as number);
      }}
      size="small"
      sx={{ width: 100 }}
    />
  );
};
