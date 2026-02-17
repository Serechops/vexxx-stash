import React from "react";
import { Box } from "@mui/material";
import { ErrorMessage } from "../Shared/ErrorMessage";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { HoverPopover } from "../Shared/HoverPopover";
import { useFindPerformer } from "../../core/StashService";
import { PerformerCard } from "./PerformerCard";
import { useConfigurationContext } from "../../hooks/Config";

interface IPeromerPopoverCardProps {
  id: string;
  cardWidth?: number;
}

export const PerformerPopoverCard: React.FC<IPeromerPopoverCardProps> = ({
  id,
  cardWidth,
}) => {
  const { data, loading, error } = useFindPerformer(id);

  if (loading)
    return (
      <Box className="tag-popover-card-placeholder" sx={{ minWidth: "20rem", minHeight: "10rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <LoadingIndicator card={true} message={""} />
      </Box>
    );
  if (error) return <ErrorMessage error={error.message} />;
  if (!data?.findPerformer)
    return <ErrorMessage error={`No tag found with id ${id}.`} />;

  const performer = data.findPerformer;

  return (
    <Box className="tag-popover-card">
      <PerformerCard performer={performer} zoomIndex={0} cardWidth={cardWidth} />
    </Box>
  );
};

interface IPeroformerPopoverProps {
  id: string;
  hide?: boolean;
  placement?: "top" | "bottom" | "left" | "right";
  target?: React.RefObject<HTMLElement>;
  cardWidth?: number;
}

export const PerformerPopover: React.FC<IPeroformerPopoverProps> = ({
  id,
  hide,
  children,
  placement = "top",
  target,
  cardWidth,
}) => {
  const { configuration: config } = useConfigurationContext();

  const showPerformerCardOnHover = config?.ui.showTagCardOnHover ?? true;

  if (hide || !showPerformerCardOnHover) {
    return <>{children}</>;
  }

  return (
    <HoverPopover
      target={target}
      placement={placement}
      enterDelay={500}
      leaveDelay={100}
      content={<PerformerPopoverCard id={id} cardWidth={cardWidth} />}
    >
      {children}
    </HoverPopover>
  );
};
