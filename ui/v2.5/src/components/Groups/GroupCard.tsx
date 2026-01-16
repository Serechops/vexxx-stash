import React, { useMemo, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import * as GQL from "src/core/generated-graphql";
import { PatchComponent } from "src/patch";
import { GridCard } from "../Shared/GridCard/GridCard";
import { TagLink } from "../Shared/TagLink";
import { RatingBanner } from "../Shared/RatingBanner";
import cx from "classnames";
import InfoIcon from "@mui/icons-material/Info";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FolderCopyIcon from "@mui/icons-material/FolderCopy";
import { OCounterButton } from "../Shared/CountButton";
import { SceneLink } from "../Shared/TagLink";
import ScreenUtils from "src/utils/screen";

interface IProps {
  group: GQL.ListGroupDataFragment;
  cardWidth?: number;
  sceneNumber?: number;
  selecting?: boolean;
  selected?: boolean;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
  fromGroupId?: string;
  onMove?: (srcIds: string[], targetId: string, after: boolean) => void;
}

const GroupCardFrontOverlays: React.FC<{
  group: GQL.ListGroupDataFragment;
  setIsFlipped: (flipped: boolean) => void;
}> = ({ group, setIsFlipped }) => {
  return (
    <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none">
      {/* Top Section */}
      <div className="flex justify-between items-start pointer-events-auto">
        <div className="flex gap-1">
          {group.rating100 && (
            <div className="text-xs px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm">
              <RatingBanner rating={group.rating100} />
            </div>
          )}
        </div>
        <button
          className="p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setIsFlipped(true);
          }}
          title="View Details"
        >
          <InfoIcon sx={{ height: 16, width: 16 }} />
        </button>
      </div>

      {/* Bottom Section */}
      <div className="mt-auto pointer-events-auto">
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/80 to-transparent -z-10" />

        <div className="flex flex-col gap-0.5 text-white pb-1">
          <span className="font-bold text-lg leading-tight truncate drop-shadow-sm">
            {group.name}
          </span>

          <div className="flex items-center gap-2 text-xs text-gray-300 font-medium">
            {group.date && <span>{group.date}</span>}
            {group.scenes.length > 0 && (
              <>
                <span className="w-1 h-1 bg-gray-500 rounded-full" />
                <span>{group.scenes.length} scenes</span>
              </>
            )}
            {(group.o_counter ?? 0) > 0 && (
              <>
                <span className="w-1 h-1 bg-gray-500 rounded-full" />
                <OCounterButton value={group.o_counter ?? 0} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const GroupCardImage: React.FC<{
  group: GQL.ListGroupDataFragment;
}> = ({ group }) => {
  return (
    <div className="w-full h-full bg-gray-900 aspect-[2/3] relative group-card-image-container">
      <img
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-700"
        alt={group.name ?? ""}
        src={group.front_image_path ?? ""}
      />
      <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors duration-300" />
    </div>
  );
};

export const GroupCard: React.FC<IProps> = PatchComponent(
  "GroupCard",
  (props) => {
    const {
      group,
      cardWidth,
      selecting,
      selected,
      onSelectedChanged,
      zoomIndex,
      onMove,
    } = props;

    const [isFlipped, setIsFlipped] = useState(false);
    const history = useHistory();

    const groupDescription = useMemo(() => {
      if (!props.fromGroupId) return undefined;
      const containingGroup = group.containing_groups.find(
        (cg) => cg.group.id === props.fromGroupId
      );
      return containingGroup?.description ?? undefined;
    }, [props.fromGroupId, group.containing_groups]);

    return (
      <div
        className={`scene-card-flip-container group perspective-1000 relative h-full grid-card mb-6 mx-2`}
        style={
          cardWidth && !ScreenUtils.isMobile()
            ? { width: `${cardWidth}px` }
            : {}
        }
      >
        <div
          className={cx(
            "scene-card-inner relative w-full h-full transition-transform duration-500 transform-style-3d bg-card rounded-xl shadow-sm border-none",
            isFlipped ? "rotate-y-180" : ""
          )}
        >
          {/* FRONT FACE */}
          <div className="scene-card-front relative w-full h-full backface-hidden top-0 left-0">
            <GridCard
              className={`group-card zoom-${zoomIndex} !rounded-xl overflow-hidden shadow-md hover:shadow-xl !border-none !bg-gray-900 !p-0 !m-0 hover:!scale-100 !transition-none`}
              objectId={group.id}
              onMove={onMove}
              url={`/groups/${group.id}`}
              width={undefined}
              title={undefined}
              image={<GroupCardImage group={group} />}
              overlays={
                <GroupCardFrontOverlays
                  group={group}
                  setIsFlipped={setIsFlipped}
                />
              }
              details={undefined}
              popovers={undefined} // Popovers removed for cleaner look, available on back
              selected={selected}
              selecting={selecting}
              onSelectedChanged={onSelectedChanged}
              thumbnailSectionClassName="h-full w-full relative !p-0 !m-0"
            />
          </div>

          {/* BACK FACE */}
          <div
            className="scene-card-back absolute w-full h-full backface-hidden rotate-y-180 top-0 left-0 bg-card rounded-xl overflow-hidden border border-border/10 shadow-xl flex flex-col p-4 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onMouseUp={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-2 flex-shrink-0">
              <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
                Details
              </h3>
              <button
                className="p-1.5 rounded-full hover:bg-secondary text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.nativeEvent.stopImmediatePropagation();
                  setIsFlipped(false);
                }}
                title="Back to Preview"
              >
                <ContentCopyIcon sx={{ height: 16, width: 16, transform: 'rotate(180deg)' }} />
              </button>
            </div>

            {/* Synopsis */}
            <div className="mb-3 flex-shrink-0 max-h-[50%] overflow-y-auto scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent pr-1 overscroll-contain">
              {props.sceneNumber !== undefined && (
                <div className="text-xs font-bold text-primary mb-1">
                  Scene #{props.sceneNumber}
                </div>
              )}
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap font-medium">
                {groupDescription || group.synopsis || (
                  <span className="text-muted-foreground italic">
                    No description available.
                  </span>
                )}
              </p>
            </div>

            {/* Tags & Metadata */}
            <div className="flex-grow overflow-y-auto border-t border-border/20 pt-3 scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent overscroll-contain">
              {/* Containing Groups */}
              {group.containing_groups.length > 0 && (
                <div className="mb-2">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase mb-1">Part of</h4>
                  <div className="flex flex-wrap gap-1">
                    {group.containing_groups.map(cg => (
                      <Link
                        key={cg.group.id}
                        to={`/groups/${cg.group.id}`}
                        className="px-2 py-0.5 bg-secondary hover:bg-primary/20 text-secondary-foreground hover:text-primary text-[10px] font-bold rounded-sm transition-colors"
                      >
                        <FolderCopyIcon sx={{ mr: 0.5, height: 12, width: 12, display: 'inline' }} />
                        {cg.group.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5 content-start">
                {group.tags.length > 0 && (
                  <>
                    <h4 className="w-full text-xs font-bold text-muted-foreground uppercase mb-1">Tags</h4>
                    {group.tags.map((tag) => (
                      <TagLink
                        key={tag.id}
                        tag={tag}
                        linkType="group"
                        className="px-2 py-0.5 bg-secondary hover:bg-primary/20 text-secondary-foreground hover:text-primary text-[10px] uppercase font-bold tracking-wide rounded-sm transition-colors cursor-pointer block"
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
