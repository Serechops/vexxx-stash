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
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6 p-4">
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
