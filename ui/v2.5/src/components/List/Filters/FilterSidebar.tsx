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
        {/* Only keep what's strictly needed in sidebar if not in toolbar. 
            User said "pagination controls and other filter options always visible and above".
            This implies we move them OUT of here. 
            However, we usually keep a header or at least nothing if everything is in the toolbar. 
            I'll leave an empty div or minimal structure if needed, but 'FilteredSidebarHeader' was mainly for these controls.
        */}
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
