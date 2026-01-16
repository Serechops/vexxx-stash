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
  Tooltip
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
  faFilm,
  faImage,
  faImages,
  faMapMarkerAlt,
  faPlayCircle,
  faQuestionCircle,
  faSignOutAlt,
  faTag,
  faUser,
  faVideo,
} from "@fortawesome/free-solid-svg-icons";
import { baseURL } from "src/core/createClient";
import { PatchComponent } from "src/patch";

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

export const MainNavbar: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const { configuration } = useConfigurationContext();
  const { openManual } = React.useContext(ManualStateContext);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));

  const [expanded, setExpanded] = useState(false);

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

  function renderUtilityButtons() {
    return (
      <>
        <Tooltip title={intl.formatMessage({ id: "donate" })}>
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
          <ListItem key={href} disablePadding>
            <ListItemButton component={NavLink} to={href} onClick={handleDismiss}>
              <ListItemIcon>
                <Icon icon={icon} />
              </ListItemIcon>
              <ListItemText primary={intl.formatMessage(message)} />
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
              mx: 0.5,
              '&.active': {
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
              }
            }}
            activeClassName="active" // NavLink prop
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
        className="top-nav !bg-background/90 backdrop-blur-md border-b border-white/5 shadow-sm transition-all duration-300"
        elevation={0}
      >
        <Toolbar variant="dense" sx={{ minHeight: 48, height: 48, py: 0 }}>
          {/* Mobile Drawer Toggle */}
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={() => setExpanded(!expanded)}
            sx={{ mr: 2, display: { lg: 'none' } }}
          >
            <Icon icon={faBars} />
          </IconButton>

          {/* Brand */}
          <Box
            component={Link}
            to="/"
            onClick={handleDismiss}
            sx={{ display: 'flex', alignItems: 'center', mr: 2, textDecoration: 'none', height: '100%' }}
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
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {!!newPath && (
              <Box mr={2}>
                <Button
                  component={Link}
                  to={newPath}
                  variant="contained"
                  className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 border-none rounded-full px-4 py-1.5 shadow-md hover:shadow-pink-500/25 transition-all duration-300 font-bold text-white text-sm"
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

      {/* Mobile Drawer */}
      <Drawer
        anchor="left"
        open={expanded}
        onClose={() => setExpanded(false)}
        sx={{ display: { lg: 'none' } }}
      >
        <Box width={250} role="presentation">
          <List>
            {renderMenuItems(true)}
          </List>
        </Box>
      </Drawer>
    </>
  );
};
