import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  defineMessages,
  FormattedMessage,
  MessageDescriptor,
  useIntl,
} from "react-intl";
import {
  AppBar,
  Toolbar,
  Button,
  IconButton,
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  useMediaQuery,
  useTheme,
  Tooltip,
  Chip,
  alpha,
  Divider,
  SwipeableDrawer,
} from "@mui/material";
import { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { Link, NavLink, useLocation, useHistory } from "react-router-dom";
import Mousetrap from "mousetrap";

import SessionUtils from "src/utils/session";
import { Icon } from "src/components/Shared/Icon";
import { useConfigurationContext } from "src/hooks/Config";
import { ManualStateContext } from "./Help/context";
import { SettingsButton } from "./SettingsButton";
import {
  faBars,
  faChartColumn,
  faCompass,
  faFilm,
  faImage,
  faImages,
  faListUl,
  faMapMarkerAlt,
  faMicrochip,
  faPlayCircle,
  faQuestionCircle,
  faSignOutAlt,
  faTag,
  faUser,
  faVideo,
} from "@fortawesome/free-solid-svg-icons";
import { baseURL } from "src/core/createClient";
import { PatchComponent } from "src/patch";
import * as GQL from "src/core/generated-graphql";

interface IMenuItem {
  name: string;
  message: MessageDescriptor;
  href: string;
  icon: IconDefinition;
  hotkey: string;
  userCreatable?: boolean;
}
const messages = defineMessages({
  scenes: {
    id: "scenes",
    defaultMessage: "Scenes",
  },
  discover: {
    id: "discover",
    defaultMessage: "Discover",
  },
  images: {
    id: "images",
    defaultMessage: "Images",
  },
  groups: {
    id: "groups",
    defaultMessage: "Groups",
  },
  markers: {
    id: "markers",
    defaultMessage: "Markers",
  },
  performers: {
    id: "performers",
    defaultMessage: "Performers",
  },
  studios: {
    id: "studios",
    defaultMessage: "Studios",
  },
  tags: {
    id: "tags",
    defaultMessage: "Tags",
  },
  galleries: {
    id: "galleries",
    defaultMessage: "Galleries",
  },
  playlists: {
    id: "playlists",
    defaultMessage: "Playlists",
  },
  sceneTagger: {
    id: "sceneTagger",
    defaultMessage: "Scene Tagger",
  },
  donate: {
    id: "patreon",
    defaultMessage: "Patreon",
  },
  statistics: {
    id: "statistics",
    defaultMessage: "Statistics",
  },
});

const allMenuItems: IMenuItem[] = [
  {
    name: "scenes",
    message: messages.scenes,
    href: "/scenes",
    icon: faPlayCircle,
    hotkey: "g s",
    userCreatable: true,
  },
  {
    name: "discover",
    message: messages.discover,
    href: "/discover",
    icon: faCompass,
    hotkey: "g d",
  },
  {
    name: "images",
    message: messages.images,
    href: "/images",
    icon: faImage,
    hotkey: "g i",
  },
  {
    name: "groups",
    message: messages.groups,
    href: "/groups",
    icon: faFilm,
    hotkey: "g v",
    userCreatable: true,
  },
  {
    name: "markers",
    message: messages.markers,
    href: "/scenes/markers",
    icon: faMapMarkerAlt,
    hotkey: "g k",
  },
  {
    name: "galleries",
    message: messages.galleries,
    href: "/galleries",
    icon: faImages,
    hotkey: "g l",
    userCreatable: true,
  },
  {
    name: "playlists",
    message: messages.playlists,
    href: "/playlists",
    icon: faListUl,
    hotkey: "g y",
    userCreatable: true,
  },
  {
    name: "performers",
    message: messages.performers,
    href: "/performers",
    icon: faUser,
    hotkey: "g p",
    userCreatable: true,
  },
  {
    name: "studios",
    message: messages.studios,
    href: "/studios",
    icon: faVideo,
    hotkey: "g u",
    userCreatable: true,
  },
  {
    name: "tags",
    message: messages.tags,
    href: "/tags",
    icon: faTag,
    hotkey: "g t",
    userCreatable: true,
  },
];

const newPathsList = allMenuItems
  .filter((item) => item.userCreatable)
  .map((item) => item.href);

const MainNavbarMenuItems = PatchComponent(
  "MainNavBar.MenuItems",
  (props: React.PropsWithChildren<{}>) => {
    return <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' } }}>{props.children}</Box>;
  }
);

const MainNavbarUtilityItems = PatchComponent(
  "MainNavBar.UtilityItems",
  (props: React.PropsWithChildren<{}>) => {
    return <Box sx={{ display: 'flex', alignItems: 'center' }}>{props.children}</Box>;
  }
);

// Helper to get a short display name for hardware codec
function getHWCodecShortName(codecName: string): string {
  if (codecName.includes("NVENC")) return "NVENC";
  if (codecName.includes("AMF")) return "AMF";
  if (codecName.includes("QSV")) return "QSV";
  if (codecName.includes("VideoToolbox")) return "VT";
  if (codecName.includes("VAAPI")) return "VAAPI";
  if (codecName.includes("V4L2M2M")) return "V4L2";
  if (codecName.includes("Rockchip") || codecName.includes("rkmpp")) return "RKMPP";
  return codecName;
}

// Get unique short names from hardware codecs
function getUniqueHWCodecTypes(codecs: string[]): string[] {
  const types = new Set<string>();
  codecs.forEach(c => types.add(getHWCodecShortName(c)));
  return Array.from(types);
}

export const MainNavbar: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const { configuration } = useConfigurationContext();
  const { openManual } = React.useContext(ManualStateContext);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));

  const [expanded, setExpanded] = useState(false);

  // Fetch system status for hardware codec info
  const { data: systemStatusData } = GQL.useSystemStatusQuery();
  const hardwareCodecs = systemStatusData?.systemStatus.hardwareCodecs ?? [];

  // Show all menu items by default, unless config says otherwise
  const menuItems = useMemo(() => {
    let cfgMenuItems = configuration?.interface.menuItems;
    if (!cfgMenuItems) {
      return allMenuItems;
    }

    // translate old movies menu item to groups
    cfgMenuItems = cfgMenuItems.map((item) => {
      if (item === "movies") {
        return "groups";
      }
      return item;
    });

    return allMenuItems.filter((menuItem) =>
      cfgMenuItems!.includes(menuItem.name)
    );
  }, [configuration]);

  const intl = useIntl();

  const goto = useCallback(
    (page: string) => {
      history.push(page);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    [history]
  );

  const pathname = location.pathname.replace(/\/$/, "");
  let newPath = newPathsList.includes(pathname) ? `${pathname}/new` : null;
  if (newPath !== null) {
    let queryParam = new URLSearchParams(location.search).get("q");
    if (queryParam) {
      newPath += "?q=" + encodeURIComponent(queryParam);
    }
  }

  // set up hotkeys
  useEffect(() => {
    Mousetrap.bind("?", () => openManual());
    Mousetrap.bind("g z", () => goto("/settings"));

    menuItems.forEach((item) =>
      Mousetrap.bind(item.hotkey, () => goto(item.href))
    );

    if (newPath) {
      Mousetrap.bind("n", () => history.push(String(newPath)));
    }

    return () => {
      Mousetrap.unbind("?");
      Mousetrap.unbind("g z");
      menuItems.forEach((item) => Mousetrap.unbind(item.hotkey));

      if (newPath) {
        Mousetrap.unbind("n");
      }
    };
  });

  function maybeRenderLogout() {
    if (SessionUtils.isLoggedIn()) {
      return (
        <Tooltip title={intl.formatMessage({ id: "actions.logout" })}>
          <IconButton
            className="minimal logout-button"
            href={`${baseURL}logout`}
            color="inherit"
            size="small"
          >
            <Icon icon={faSignOutAlt} />
          </IconButton>
        </Tooltip>
      );
    }
  }

  const handleDismiss = useCallback(() => setExpanded(false), [setExpanded]);

  function renderHardwareAccelerationChip() {
    if (hardwareCodecs.length === 0) {
      return null;
    }

    const uniqueTypes = getUniqueHWCodecTypes(hardwareCodecs);
    const chipLabel = uniqueTypes.join(" / ");
    const tooltipText = hardwareCodecs.join("\n");

    return (
      <Tooltip
        title={
          <Box sx={{ whiteSpace: 'pre-line' }}>
            <strong>Hardware Encoding:</strong>
            {"\n"}
            {tooltipText}
          </Box>
        }
      >
        <Chip
          icon={<Icon icon={faMicrochip} />}
          label={chipLabel}
          size="small"
          sx={{
            mr: 1,
            height: 24,
            backgroundColor: 'rgba(76, 175, 80, 0.15)',
            borderColor: 'rgba(76, 175, 80, 0.5)',
            border: '1px solid',
            color: '#81c784',
            '& .MuiChip-icon': {
              color: '#81c784',
            },
            '& .MuiChip-label': {
              fontSize: '0.75rem',
              fontWeight: 500,
            },
          }}
        />
      </Tooltip>
    );
  }

  function renderUtilityButtons() {
    return (
      <>
        {renderHardwareAccelerationChip()}
        <Tooltip title={intl.formatMessage({ id: "Support Me" })}>
          <IconButton
            component="a"
            href="https://www.patreon.com/c/Creat1veB1te"
            target="_blank"
            onClick={handleDismiss}
            color="inherit"
            size="small"
          >
            <img
              src="/patreon.png"
              alt="Patreon"
              style={{ height: "1em", width: "auto" }}
            />
          </IconButton>
        </Tooltip>

        <Tooltip title={intl.formatMessage({ id: "statistics" })}>
          <IconButton
            component={NavLink}
            to="/stats"
            onClick={handleDismiss}
            color="inherit"
            size="small"
          >
            <Icon icon={faChartColumn} />
          </IconButton>
        </Tooltip>

        <NavLink
          to="/settings"
          onClick={handleDismiss}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <SettingsButton />
        </NavLink>

        <Tooltip title={intl.formatMessage({ id: "help" })}>
          <IconButton
            className="nav-utility minimal"
            onClick={() => openManual()}
            color="inherit"
            size="small"
          >
            <Icon icon={faQuestionCircle} />
          </IconButton>
        </Tooltip>
        {maybeRenderLogout()}
      </>
    );
  }

  const renderMenuItems = (isDrawer: boolean) => (
    <MainNavbarMenuItems>
      {menuItems.map(({ href, icon, message }) => (
        isDrawer ? (
          <ListItem key={href} disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton 
              component={NavLink} 
              to={href} 
              onClick={handleDismiss}
              sx={{
                borderRadius: 2,
                mx: 0.5,
                py: 1.25,
                transition: 'all 0.15s ease',
                '&:hover': {
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
                },
                '&.active': {
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
                  '& .MuiListItemIcon-root': {
                    color: 'primary.main',
                  },
                  '& .MuiListItemText-primary': {
                    color: 'primary.main',
                    fontWeight: 600,
                  },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'text.secondary' }}>
                <Icon icon={icon} />
              </ListItemIcon>
              <ListItemText 
                primary={intl.formatMessage(message)} 
                primaryTypographyProps={{
                  fontSize: '0.9375rem',
                  fontWeight: 500,
                }}
              />
            </ListItemButton>
          </ListItem>
        ) : (
          <Button
            key={href}
            component={NavLink}
            to={href}
            color="inherit"
            startIcon={<Icon icon={icon} />}
            sx={{
              textTransform: 'none',
              mx: 0.25,
              px: 1.5,
              py: 0.75,
              borderRadius: 1.5,
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'text.secondary',
              transition: 'all 0.15s ease',
              '&:hover': {
                bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
                color: 'text.primary',
              },
              '&.active': {
                bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
                color: 'primary.main',
                fontWeight: 600,
              },
            }}
            activeClassName="active"
          >
            {intl.formatMessage(message)}
          </Button>
        )
      ))}
    </MainNavbarMenuItems>
  );

  return (
    <>
      <AppBar
        position="fixed"
        color="default"
        elevation={0}
        sx={{
          bgcolor: (t) => alpha(t.palette.background.default, 0.85),
          backdropFilter: 'blur(12px)',
          borderBottom: 1,
          borderColor: (t) => alpha(t.palette.divider, 0.1),
          transition: 'all 0.3s ease',
        }}
        className="top-nav vexxx-navbar"
      >
        <Toolbar variant="dense" sx={{ minHeight: 48, height: 48, py: 0 }}>
          {/* Mobile Drawer Toggle */}
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={() => setExpanded(!expanded)}
            sx={{ 
              mr: 1, 
              display: { lg: 'none' },
              transition: 'transform 0.2s ease',
              '&:hover': {
                transform: 'scale(1.1)',
              },
            }}
          >
            <Icon icon={faBars} />
          </IconButton>

          {/* Brand */}
          <Box
            component={Link}
            to="/"
            onClick={handleDismiss}
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              mr: 2, 
              textDecoration: 'none', 
              height: '100%',
              transition: 'opacity 0.2s ease',
              '&:hover': {
                opacity: 0.8,
              },
            }}
          >
            <img
              src="/vexxx.png"
              alt="Vexxx"
              style={{ height: '72px', width: 'auto', objectFit: 'cover' }}
            />
          </Box>

          {/* Desktop Menu */}
          <Box sx={{ display: { xs: 'none', lg: 'flex' }, flexGrow: 1 }}>
            {renderMenuItems(false)}
          </Box>

          {/* Spacer for Mobile/Tablet to push utils to right */}
          <Box sx={{ flexGrow: { xs: 1, lg: 0 } }} />

          {/* Right Side Buttons */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {!!newPath && (
              <Box mr={1}>
                <Button
                  component={Link}
                  to={newPath}
                  variant="contained"
                  sx={{
                    background: 'linear-gradient(135deg, #db2777 0%, #9333ea 100%)',
                    border: 'none',
                    borderRadius: '20px',
                    px: 2.5,
                    py: 0.75,
                    fontWeight: 600,
                    fontSize: '0.8125rem',
                    textTransform: 'none',
                    boxShadow: (t) => `0 4px 12px ${alpha('#db2777', 0.3)}`,
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
                      boxShadow: (t) => `0 6px 20px ${alpha('#db2777', 0.4)}`,
                      transform: 'translateY(-1px)',
                    },
                    '&:active': {
                      transform: 'translateY(0)',
                    },
                  }}
                >
                  <FormattedMessage id="new" defaultMessage="New" />
                </Button>
              </Box>
            )}

            <MainNavbarUtilityItems>
              {renderUtilityButtons()}
            </MainNavbarUtilityItems>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Mobile Drawer - Enhanced with SwipeableDrawer */}
      <SwipeableDrawer
        anchor="left"
        open={expanded}
        onClose={() => setExpanded(false)}
        onOpen={() => setExpanded(true)}
        disableSwipeToOpen={false}
        swipeAreaWidth={20}
        sx={{ 
          display: { lg: 'none' },
          '& .MuiDrawer-paper': {
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            borderRight: 1,
            borderColor: 'divider',
            width: 280,
          },
        }}
      >
        <Box role="presentation" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Drawer Header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              py: 2,
              px: 2,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <img
              src="/vexxx.png"
              alt="Vexxx"
              style={{ height: '48px', width: 'auto', objectFit: 'contain' }}
            />
          </Box>

          {/* Menu Items */}
          <List sx={{ flex: 1, py: 1, px: 1 }}>
            {renderMenuItems(true)}
          </List>

          {/* Drawer Footer with Quick Actions */}
          <Divider />
          <Box sx={{ p: 2 }}>
            {!!newPath && (
              <Button
                component={Link}
                to={newPath}
                fullWidth
                variant="contained"
                onClick={handleDismiss}
                sx={{
                  background: 'linear-gradient(135deg, #db2777 0%, #9333ea 100%)',
                  borderRadius: 2,
                  py: 1.25,
                  fontWeight: 600,
                  mb: 1,
                }}
              >
                <FormattedMessage id="new" defaultMessage="New" />
              </Button>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
              {renderUtilityButtons()}
            </Box>
          </Box>
        </Box>
      </SwipeableDrawer>
    </>
  );
};
