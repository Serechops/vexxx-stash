import React, {
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { IViewConfig, useInterfaceLocalForage } from "src/hooks/LocalForage";
import { View } from "../List/views";
import { useHistory } from "react-router-dom";
import ScreenUtils from "src/utils/screen";

export type SidebarSectionStates = Record<string, boolean>;

const mobileSidebarQuery = "only screen and (max-width: 767px)";

// show sidebar by default if not on mobile
export function defaultShowSidebar() {
  return !ScreenUtils.matchesMediaQuery(mobileSidebarQuery);
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface IContext {
  sectionOpen: SidebarSectionStates;
  setSectionOpen: (section: string, open: boolean) => void;
}

export const SidebarStateContext = React.createContext<IContext | null>(null);

// ─── SidebarPanel ────────────────────────────────────────────────────────────
// Always-visible vertical filter panel. Lives in normal document flow,
// side-by-side with the content grid in a flex row.

export const InlineFilterPanel: React.FC<PropsWithChildren> =
  ({ children }) => (
    <Box
      sx={{
        width: 260,
        flexShrink: 0,
        alignSelf: "stretch",
      }}
    >
      <Box sx={{ position: "sticky", top: 112, p: { xs: 1, md: 1.5 }, maxHeight: "calc(100vh - 130px)", overflowY: "auto", overflowX: "hidden" }}>
        {children}
      </Box>
    </Box>
  );

// ─── SidebarSection ───────────────────────────────────────────────────────────
// MUI Accordion, controlled via SidebarStateContext so open/close state is
// persisted in history.location.state (same as before).

export interface ISidebarSectionProps {
  text: React.ReactNode;
  className?: string;
  outsideCollapse?: React.ReactNode;
  onOpen?: () => void;
  sectionID?: string;
}

export const SidebarSection: React.FC<
  PropsWithChildren<ISidebarSectionProps>
> = ({ text, sectionID = "", children, onOpen, outsideCollapse }) => {
  const contextState = useContext(SidebarStateContext);
  const expanded = contextState && sectionID
    ? (contextState.sectionOpen[sectionID] ?? true)
    : true;

  // If the section is expanded on initial mount, trigger onOpen so that
  // deferred queries (which start with skip=true) are kicked off immediately.
  const onOpenRef = React.useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    if (expanded && onOpenRef.current) {
      onOpenRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  const handleChange = (_: React.SyntheticEvent, isExpanded: boolean) => {
    if (contextState && sectionID) {
      contextState.setSectionOpen(sectionID, isExpanded);
    }
    if (isExpanded && onOpen) {
      onOpen();
    }
  };

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={!!expanded}
      onChange={handleChange}
      sx={{
        bgcolor: "transparent",
        "&:before": { display: "none" },
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon fontSize="small" />}
        sx={{
          px: 0.5,
          minHeight: 40,
          "& .MuiAccordionSummary-content": {
            my: 0.5,
            alignItems: "center",
            gap: 1,
          },
        }}
      >
        <Typography
          variant="overline"
          sx={{
            lineHeight: 1.2,
            color: "text.secondary",
            fontSize: "0.7rem",
            fontWeight: 600,
          }}
        >
          {text}
        </Typography>
        {outsideCollapse}
      </AccordionSummary>
      <AccordionDetails sx={{ px: 1, pt: 1, pb: 0.5 }}>
        {children}
      </AccordionDetails>
    </Accordion>
  );
};

// ─── useSidebarState ──────────────────────────────────────────────────────────
// Unchanged logic — reads/writes view config from localForage and persists
// section open states in history.location.state.

export function useSidebarState(view?: View) {
  const [interfaceLocalForage, setInterfaceLocalForage] =
    useInterfaceLocalForage();
  const history = useHistory();

  const { data: interfaceLocalForageData, loading } = interfaceLocalForage;

  const viewConfig: IViewConfig = useMemo(() => {
    return view ? interfaceLocalForageData?.viewConfig?.[view] || {} : {};
  }, [view, interfaceLocalForageData]);

  const [showSidebar, setShowSidebar] = useState<boolean>();
  const [sectionOpen, setSectionOpen] = useState<SidebarSectionStates>();

  // set initial state once loading is done
  useEffect(() => {
    if (showSidebar !== undefined) return;

    if (!view) {
      setShowSidebar(defaultShowSidebar());
      return;
    }

    if (loading) return;

    // only show sidebar by default on large screens
    setShowSidebar(!!viewConfig.showSidebar && defaultShowSidebar());
    setSectionOpen(
      (history.location.state as { sectionOpen?: SidebarSectionStates })
        ?.sectionOpen || {}
    );
  }, [
    view,
    loading,
    showSidebar,
    viewConfig.showSidebar,
    history.location.state,
  ]);

  const onSetShowSidebar = useCallback(
    (show: boolean | ((prevState: boolean | undefined) => boolean)) => {
      const nv = typeof show === "function" ? show(showSidebar) : show;
      setShowSidebar(nv);
      if (view === undefined) return;

      setInterfaceLocalForage((prev) => ({
        ...prev,
        viewConfig: {
          ...prev.viewConfig,
          [view]: {
            ...viewConfig,
            showSidebar: nv,
          },
        },
      }));
    },
    [showSidebar, setInterfaceLocalForage, view, viewConfig]
  );

  const onSetSectionOpen = useCallback(
    (section: string, open: boolean) => {
      const newSectionOpen = { ...sectionOpen, [section]: open };
      setSectionOpen(newSectionOpen);
      if (view === undefined) return;

      history.replace({
        ...history.location,
        state: {
          ...(history.location.state as {}),
          sectionOpen: newSectionOpen,
        },
      });
    },
    [sectionOpen, view, history]
  );

  return {
    showSidebar: showSidebar ?? defaultShowSidebar(),
    sectionOpen: sectionOpen || {},
    setShowSidebar: onSetShowSidebar,
    setSectionOpen: onSetSectionOpen,
    loading: showSidebar === undefined,
  };
}
