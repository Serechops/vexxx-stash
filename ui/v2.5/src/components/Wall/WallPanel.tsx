import React, { MouseEvent } from "react";
import { Box } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import { SceneQueue } from "src/models/sceneQueue";
import { WallItem, WallItemData, WallItemType } from "./WallItem";

interface IWallPanelProps<T extends WallItemType> {
  type: T;
  data: WallItemData[T][];
  sceneQueue?: SceneQueue;
  clickHandler?: (e: MouseEvent, item: WallItemData[T]) => void;
}

import { useZoomContext } from "src/hooks/ZoomContext";
import { maxZoom } from "src/components/List/ZoomSlider";

const calculateClass = (index: number, count: number, columns: number) => {
  const isFirstColumn = index % columns === 0;
  const isLastColumn = index % columns === columns - 1;
  const isFirstRow = index < columns;

  // Calculate the index of the first item in the last row
  const lastRowStartIndex = count - (count % columns || columns);
  const isLastRow = index >= lastRowStartIndex;

  // Corner cases
  if (index === 0 && !isLastRow) return "transform-origin-top-left";
  if (index === columns - 1 && !isLastRow) return "transform-origin-top-right";
  if (isLastRow && index === lastRowStartIndex + columns - 1) return "transform-origin-bottom-right"; // Last item, full row
  if (isLastRow && index === lastRowStartIndex) return "transform-origin-bottom-left";

  // Edges
  if (isFirstRow) return "transform-origin-top";
  if (isLastRow) return "transform-origin-bottom";
  if (isLastColumn) return "transform-origin-right";
  if (isFirstColumn) return "transform-origin-left";

  // Default
  return "transform-origin-center";
};

const WallPanel = <T extends WallItemType>({
  type,
  data,
  sceneQueue,
  clickHandler,
}: IWallPanelProps<T>) => {
  const { getZoom } = useZoomContext();
  const zoomMode = type === "sceneMarker" ? GQL.FilterMode.SceneMarkers : GQL.FilterMode.Scenes;
  const zoomIndex = getZoom(zoomMode);

  // Standard Wall is 5 columns, but customized to 6-wide (zoom 0) down to 2-wide (zoom 4)
  // Maps zoom index to columns: 0->6, 1->5, 2->4, 3->3, 4->2
  const columns = Math.max(2, 6 - zoomIndex);

  function renderItems() {
    return data.map((item, index, arr) => (
      <WallItem
        type={type}
        key={item.id}
        index={index}
        data={item}
        sceneQueue={sceneQueue}
        clickHandler={clickHandler}
        className={calculateClass(index, arr.length, columns)}
        zoomIndex={zoomIndex}
        columns={columns}
      />
    ));
  }

  return (

    <Box className="flex flex-wrap">
      <Box
        className="stash-wall w-full flex flex-wrap justify-center"
        sx={{
          margin: "0 auto",
          maxWidth: 2250,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {renderItems()}
      </Box>
    </Box>
  );

};

interface IMarkerWallPanelProps {
  markers: GQL.SceneMarkerDataFragment[];
  clickHandler?: (e: MouseEvent, item: GQL.SceneMarkerDataFragment) => void;
}

export const MarkerWallPanel: React.FC<IMarkerWallPanelProps> = ({
  markers,
  clickHandler,
}) => {
  return (
    <WallPanel type="sceneMarker" data={markers} clickHandler={clickHandler} />
  );
};
