import React, { useEffect } from "react";
import { FormattedMessage } from "react-intl";
import { SidebarSection } from "src/components/Shared/Sidebar";
import { ListFilterModel } from "src/models/list-filter/filter";
import { PageSizeSelector, SearchTermInput, SortBySelect } from "../ListFilter";
import { SidebarSavedFilterList } from "../SavedFilterList";
import { ListViewButtonGroup } from "../ListViewOptions";
import { View } from "../views";
import useFocus from "src/utils/focus";
import ScreenUtils from "src/utils/screen";
import Mousetrap from "mousetrap";
import { Button } from "react-bootstrap";
import cx from "classnames";

const savedFiltersSectionID = "saved-filters";

export interface ISidebarOperation {
  text: string;
  onClick: () => void;
  isDisplayed?: () => boolean;
  className?: string; // e.g. "play-item", "create-new-item"
  icon?: any; // IconDefinition
}

export const FilteredSidebarHeader: React.FC<{
  sidebarOpen: boolean;
  showEditFilter: () => void;
  filter: ListFilterModel;
  setFilter: (filter: ListFilterModel) => void;
  view?: View;
  focus?: ReturnType<typeof useFocus>;
  operations?: ISidebarOperation[];
}> = ({
  sidebarOpen,
  showEditFilter,
  filter,
  setFilter,
  view,
  focus: providedFocus,
  operations,
}) => {
    const localFocus = useFocus();
    const focus = providedFocus ?? localFocus;
    const [, setFocus] = focus;

    // Set the focus on the input field when the sidebar is opened
    // Don't do this on touch devices
    useEffect(() => {
      if (sidebarOpen && !ScreenUtils.isTouch()) {
        setFocus();
      }
    }, [sidebarOpen, setFocus]);

    // Filter operations to only show relevant ones
    const activeOperations = operations?.filter(op => !op.isDisplayed || op.isDisplayed()) ?? [];
    const primaryOps = activeOperations.filter(op => op.className === "play-item" || op.className === "create-new-item" || activeOperations.length <= 3);
    const secondaryOps = activeOperations.filter(op => !primaryOps.includes(op));

    return (
      <div className="flex flex-col gap-4 mb-4">
        {/* Search Input - Dark Theme Styled */}
        <div className="sidebar-search-container px-3 mt-4">
          <SearchTermInput
            filter={filter}
            onFilterUpdate={setFilter}
            focus={focus}
          />
        </div>

        {/* Primary Actions Grid */}
        {primaryOps.length > 0 && (
          <div className="grid grid-cols-2 gap-2 px-3">
            {primaryOps.map((op, idx) => (
              <Button
                key={idx}
                variant="secondary"
                className={cx("w-full flex items-center justify-center gap-2", op.className)}
                onClick={op.onClick}
              >
                {/* Add Icons based on class or text if needed, effectively "Play" and "New" usually have icons in the generic components but we can just use text here or infer */}
                <span className="truncate">{op.text}</span>
              </Button>
            ))}
          </div>
        )}

        {/* Secondary Actions (List) */}
        {secondaryOps.length > 0 && (
          <div className="px-3 flex flex-col gap-2">
            {secondaryOps.map((op, idx) => (
              <Button
                key={idx}
                variant="outline-secondary" // Darker outline for secondary items
                size="sm"
                className="w-full text-left justify-start"
                onClick={op.onClick}
              >
                {op.text}
              </Button>
            ))}
          </div>
        )}

        {/* Filter Edit Button */}
        <div className="px-3">
          <Button
            className="edit-filter-button w-full"
            size="sm"
            variant="secondary"
            onClick={() => showEditFilter()}
          >
            <FormattedMessage id="search_filter.edit_filter" />
          </Button>
        </div>

        <SidebarSection
          className="sidebar-view-options"
          text={<FormattedMessage id="Options" />}
          sectionID="view-options"
        >
          <div className="flex flex-col gap-3">
            {/* Sort Control */}
            <SortBySelect
              sortBy={filter.sortBy}
              sortDirection={filter.sortDirection}
              options={filter.options.sortByOptions}
              onChangeSortBy={(e) => setFilter(filter.setSortBy(e ?? undefined))}
              onChangeSortDirection={() => setFilter(filter.toggleSortDirection())}
              onReshuffleRandomSort={() => setFilter(filter.reshuffleRandomSort())}
            />

            {/* View Mode */}
            <ListViewButtonGroup
              displayMode={filter.displayMode}
              displayModeOptions={filter.options.displayModeOptions}
              onSetDisplayMode={(mode) => setFilter(filter.setDisplayMode(mode))}
            />

            {/* Page Size */}
            <PageSizeSelector
              pageSize={filter.itemsPerPage}
              setPageSize={(size) => setFilter(filter.setPageSize(size))}
            />
          </div>
        </SidebarSection>

        <SidebarSection
          className="sidebar-saved-filters"
          text={<FormattedMessage id="search_filter.saved_filters" />}
          sectionID={savedFiltersSectionID}
        >
          <SidebarSavedFilterList
            filter={filter}
            onSetFilter={setFilter}
            view={view}
          />
        </SidebarSection>
      </div>
    );
  };

export function useFilteredSidebarKeybinds(props: {
  showSidebar: boolean;
  setShowSidebar: (show: boolean) => void;
}) {
  const { showSidebar, setShowSidebar } = props;

  // Hide the sidebar when the user presses the "Esc" key
  useEffect(() => {
    Mousetrap.bind("esc", (e) => {
      if (showSidebar) {
        setShowSidebar(false);
        e.preventDefault();
      }
    });

    return () => {
      Mousetrap.unbind("esc");
    };
  }, [showSidebar, setShowSidebar]);
}
