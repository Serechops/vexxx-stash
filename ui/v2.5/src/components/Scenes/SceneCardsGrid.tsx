import React from "react";
import * as GQL from "src/core/generated-graphql";
import { SceneQueue } from "src/models/sceneQueue";
import { SceneCard } from "./SceneCard";

interface ISceneCardsGrid {
  scenes: GQL.SlimSceneDataFragment[];
  queue?: SceneQueue;
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
  fromGroupId?: string;
}

export const SceneCardsGrid: React.FC<ISceneCardsGrid> = ({
  scenes,
  queue,
  selectedIds,
  zoomIndex,
  onSelectChange,
  fromGroupId,
}) => {
  function getGridClass(zoom: number) {
    switch (zoom) {
      case 0:
        // Smallest Cards (Zoomed OUT) - ~6 cols on XL
        return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7";
      case 1:
        return "grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
      case 2:
        // Medium Cards - ~4 cols on XL
        return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
      case 3:
        // Large Cards - ~3 cols on XL
        return "grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4";
      case 4:
        // Largest Cards (Zoomed IN) - ~2 cols on XL
        return "grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3";
      default:
        return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
    }
  }

  return (
    <div className={`grid ${getGridClass(zoomIndex)} gap-6 p-4`}>
      {scenes.map((scene, index) => (
        <SceneCard
          key={scene.id}
          scene={scene}
          queue={queue}
          index={index}
          zoomIndex={zoomIndex}
          selecting={selectedIds.size > 0}
          selected={selectedIds.has(scene.id)}
          onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
            onSelectChange(scene.id, selected, shiftKey)
          }
          fromGroupId={fromGroupId}
        />
      ))}
    </div>
  );
};
