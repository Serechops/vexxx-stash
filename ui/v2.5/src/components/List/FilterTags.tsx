import React, {
  PropsWithChildren,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { Chip, Button, Popover, IconButton, Box } from "@mui/material";
import { Criterion } from "src/models/list-filter/criteria/criterion";
import { FormattedMessage, useIntl } from "react-intl";
import SearchIcon from "@mui/icons-material/Search";

import { CustomFieldsCriterion } from "src/models/list-filter/criteria/custom-fields";
import { useDebounce } from "src/hooks/debounce";
import cx from "classnames";
import { useConfigurationContext } from "src/hooks/Config";

type TagItemProps = React.PropsWithChildren<{
  className?: string;
  variant?: "filled" | "outlined";
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}>;

export const TagItem: React.FC<TagItemProps> = (props) => {
  const { className, children, onClick, ...others } = props;
  return (
    <Chip
      className={className}
      label={children}
      onClick={onClick}
      size="small"
      color="secondary"
      {...others}
    />
  );
};

export const FilterTag: React.FC<{
  className?: string;
  label: React.ReactNode;
  onClick: React.MouseEventHandler<HTMLDivElement>;
  onRemove: React.MouseEventHandler<HTMLElement>;
}> = ({ className, label, onClick, onRemove }) => {
  return (
    <Chip
      className={className}
      label={label}
      onClick={onClick}
      onDelete={(e) => {
        onRemove(e as any);
        e.stopPropagation();
      }}
      size="small"
      color="secondary"
    />
  );
};

const MoreFilterTags: React.FC<{
  tags: React.ReactNode[];
}> = ({ tags }) => {
  const [anchorEl, setAnchorEl] = React.useState<HTMLDivElement | null>(null);

  if (!tags.length) {
    return null;
  }

  function handleMouseEnter(event: React.MouseEvent<HTMLDivElement>) {
    setAnchorEl(event.currentTarget);
  }

  function handleMouseLeave() {
    setAnchorEl(null);
  }

  const open = Boolean(anchorEl);

  return (
    <>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleMouseLeave}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        disableRestoreFocus
        sx={{ pointerEvents: 'none' }}
        slotProps={{
          paper: {
            onMouseEnter: () => setAnchorEl(anchorEl),
            onMouseLeave: handleMouseLeave,
            onClick: handleMouseLeave,
            sx: { pointerEvents: 'auto', p: 1 }
          }
        }}
      >
        <Box display="flex" flexWrap="wrap" gap={0.5}>
          {tags}
        </Box>
      </Popover>
      <Chip
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        size="small"
        color="secondary"
        sx={{
          backgroundColor: "transparent",
          color: (theme) => theme.palette.common.white,
        }}
        label={
          <FormattedMessage
            id="search_filter.more_filter_criteria"
            values={{ count: tags.length }}
          />
        }
      />
    </>
  );
};

interface IFilterTagsProps {
  searchTerm?: string;
  criteria: Criterion[];
  onEditSearchTerm?: () => void;
  onEditCriterion: (c: Criterion) => void;
  onRemoveCriterion: (c: Criterion, valueIndex?: number) => void;
  onRemoveAll: () => void;
  onRemoveSearchTerm?: () => void;
  truncateOnOverflow?: boolean;
}

export const FilterTags: React.FC<IFilterTagsProps> = ({
  searchTerm,
  criteria,
  onEditCriterion,
  onRemoveCriterion,
  onRemoveAll,
  onEditSearchTerm,
  onRemoveSearchTerm,
  truncateOnOverflow = false,
}) => {
  const intl = useIntl();
  const ref = useRef<HTMLDivElement>(null);

  const { configuration } = useConfigurationContext();
  const { sfwContentMode } = configuration.interface;

  const [cutoff, setCutoff] = React.useState<number | undefined>();
  const elementGap = 10; // Adjust this value based on your CSS gap or margin
  const moreTagWidth = 80; // reserve space for the "more" tag

  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const debounceResetCutoff = useDebounce(
    () => {
      setCutoff(undefined);
      // setting cutoff won't trigger a re-render if it's already undefined
      // so we force a re-render to recalculate the cutoff
      forceUpdate();
    },
    100 // Adjust the debounce delay as needed
  );

  // trigger recalculation of cutoff when control resizes
  useEffect(() => {
    if (!truncateOnOverflow || !ref.current) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      debounceResetCutoff();
    });

    const { current } = ref;
    resizeObserver.observe(current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [truncateOnOverflow, debounceResetCutoff]);

  // we need to check this on every render, and the call to setCutoff _should_ be safe
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    if (!truncateOnOverflow) {
      setCutoff(undefined);
      return;
    }

    const { current } = ref;

    if (current) {
      // calculate the number of tags that can fit in the container
      const containerWidth = current.clientWidth;
      const children = Array.from(current.children);

      // don't recalculate anything if the more tag is visible and cutoff is already set
      const moreTags = children.find((child) => {
        return (child as HTMLElement).classList.contains("more-tags");
      });

      if (moreTags && cutoff !== undefined) {
        return;
      }

      const childTags = children.filter((child) => {
        return (
          (child as HTMLElement).classList.contains("tag-item") ||
          (child as HTMLElement).classList.contains("clear-all-button")
        );
      });

      const clearAllButton = children.find((child) => {
        return (child as HTMLElement).classList.contains("clear-all-button");
      });

      // calculate the total width without the more tag
      const defaultTotalWidth = childTags.reduce((total, child, idx) => {
        return (
          total +
          ((child as HTMLElement).offsetWidth ?? 0) +
          (idx === childTags.length - 1 ? 0 : elementGap)
        );
      }, 0);

      if (containerWidth >= defaultTotalWidth) {
        // if the container is wide enough to fit all tags, reset cutoff
        setCutoff(undefined);
        return;
      }

      let totalWidth = 0;
      let visibleCount = 0;

      // reserve space for the more tags control
      totalWidth += moreTagWidth;

      // reserve space for the clear all button if present
      if (clearAllButton) {
        totalWidth += (clearAllButton as HTMLElement).offsetWidth ?? 0;
      }

      for (const child of children) {
        totalWidth += ((child as HTMLElement).offsetWidth ?? 0) + elementGap;
        if (totalWidth > containerWidth) {
          break;
        }
        visibleCount++;
      }

      setCutoff(visibleCount);
    }
  });

  function onRemoveCriterionTag(
    criterion: Criterion,
    $event: React.MouseEvent<HTMLElement, MouseEvent>,
    valueIndex?: number
  ) {
    if (!criterion) {
      return;
    }
    onRemoveCriterion(criterion, valueIndex);
    $event.stopPropagation();
  }

  function onClickCriterionTag(criterion: Criterion) {
    onEditCriterion(criterion);
  }

  function getFilterTags(criterion: Criterion) {
    if (
      criterion instanceof CustomFieldsCriterion &&
      criterion.value.length > 1
    ) {
      return criterion.value.map((value, index) => {
        return (
          <FilterTag
            key={index}
            label={criterion.getValueLabel(intl, value)}
            onClick={() => onClickCriterionTag(criterion)}
            onRemove={($event) =>
              onRemoveCriterionTag(criterion, $event, index)
            }
          />
        );
      });
    }

    return (
      <FilterTag
        key={criterion.getId()}
        label={criterion.getLabel(intl, sfwContentMode)}
        onClick={() => onClickCriterionTag(criterion)}
        onRemove={($event) => onRemoveCriterionTag(criterion, $event)}
      />
    );
  }

  if (criteria.length === 0 && !searchTerm) {
    return null;
  }

  const className = "wrap-tags";

  const filterTags = criteria.map((c) => getFilterTags(c)).flat();

  if (searchTerm && searchTerm.length > 0) {
    filterTags.unshift(
      <FilterTag
        key="search-term"
        className="search-term-filter-tag"
        label={
          <span className="search-term">
            <SearchIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
            {searchTerm}
          </span>
        }
        onClick={() => onEditSearchTerm?.()}
        onRemove={() => onRemoveSearchTerm?.()}
      />
    );
  }

  const visibleCriteria =
    cutoff !== undefined ? filterTags.slice(0, cutoff) : filterTags;
  const hiddenCriteria = cutoff !== undefined ? filterTags.slice(cutoff) : [];

  return (
    <Box
      className={className}
      ref={ref}
      sx={{
        display: "flex",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 1,
        marginBottom: 1,
        "& .more-tags": {
          backgroundColor: "transparent",
          color: (theme) => theme.palette.common.white,
        },
        "& .clear-all-button": {
          color: "text.primary",
          lineHeight: "16px",
          padding: 0,
        },
      }}
    >
      {visibleCriteria}
      <MoreFilterTags tags={hiddenCriteria} />
      {filterTags.length >= 3 && (
        <Button
          variant="text"
          size="small"
          className="clear-all-button"
          onClick={() => onRemoveAll()}
        >
          <FormattedMessage id="actions.clear" />
        </Button>
      )}
    </Box>
  );
};
