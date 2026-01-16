import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import MovieIcon from "@mui/icons-material/Movie";
import React, { useMemo } from "react";
import { Box, Button, Tooltip } from "@mui/material";
import { Count } from "../Shared/PopoverCountButton";
import { HoverPopover } from "../Shared/HoverPopover";
import { Link } from "react-router-dom";
import NavUtils from "src/utils/navigation";
import * as GQL from "src/core/generated-graphql";
import { useIntl } from "react-intl";
import { GroupTag } from "./GroupTag";

interface IProps {
  group: Pick<
    GQL.ListGroupDataFragment,
    "id" | "name" | "containing_groups" | "sub_group_count"
  >;
}

const ContainingGroupsCount: React.FC<IProps> = ({ group }) => {
  const { containing_groups: containingGroups } = group;

  const popoverContent = useMemo(() => {
    if (!containingGroups.length) {
      return [];
    }

    return containingGroups.map((entry) => (
      <GroupTag
        key={entry.group.id}
        linkType="sub_group"
        group={entry.group}
        description={entry.description ?? undefined}
      />
    ));
  }, [containingGroups]);

  if (!containingGroups.length) {
    return null;
  }

  return (
    <HoverPopover
      className="containing-group-count"
      placement="bottom"
      content={popoverContent}
    >
      <Link
        to={NavUtils.makeContainingGroupsUrl(group)}
        className="related-group-count"
      >
        <Count count={containingGroups.length} />
        <ArrowUpwardIcon sx={{ fontSize: 14 }} />
      </Link>
    </HoverPopover>
  );
};

const SubGroupCount: React.FC<IProps> = ({ group }) => {
  const intl = useIntl();

  const count = group.sub_group_count;

  if (!count) {
    return null;
  }

  function getTitle() {
    const pluralCategory = intl.formatPlural(count);
    const options = {
      one: "sub_group",
      other: "sub_groups",
    };
    const plural = intl.formatMessage({
      id: options[pluralCategory as "one"] || options.other,
    });
    return `${count} ${plural}`;
  }

  return (
    <Tooltip title={getTitle()} placement="bottom">
      <Link
        to={NavUtils.makeSubGroupsUrl(group)}
        className="related-group-count"
      >
        <Count count={count} />
        <ArrowDownwardIcon sx={{ fontSize: 14 }} />
      </Link>
    </Tooltip>
  );
};

export const RelatedGroupPopoverButton: React.FC<IProps> = ({ group }) => {
  return (
    <Box
      className="related-group-popover-button"
      sx={{
        "& .containing-group-count": {
          display: "inline-block",
        },
        "& .related-group-count .fa-icon": {
          color: "text.secondary",
          ml: 0,
          mr: 0.5,
        },
      }}
    >
      <Button className="minimal" variant="text" size="small">
        <MovieIcon fontSize="small" />
        <ContainingGroupsCount group={group} />
        <SubGroupCount group={group} />
      </Button>
    </Box>
  );
};
