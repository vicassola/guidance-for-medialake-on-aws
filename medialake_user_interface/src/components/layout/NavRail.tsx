import React, { useState, useCallback } from "react";
import {
  Box,
  Tooltip,
  Typography,
  Divider,
  Collapse,
  useTheme,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import {
  Home as HomeIcon,
  PermMedia as AssetsIcon,
  AccountTree as PipelinesIcon,
  PlaylistPlay as ExecutionsIcon,
  Collections as CollectionsIcon,
  Settings as SettingsIcon,
  ChevronRight as ExpandIcon,
  ChevronLeft as CollapseIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import { alpha } from "@mui/material/styles";
import { useNavigate, useLocation } from "react-router";
import { usePermission } from "@/permissions";
import { useTranslation } from "react-i18next";
import { springEasing, layoutTokens } from "@/constants";
import { zIndexTokens } from "@/theme/tokens";

// ── Constants ─────────────────────────────────────────────────────────────────

const RAIL_COLLAPSED_WIDTH = 56;
const RAIL_EXPANDED_WIDTH = 200;
const STORAGE_KEY = "medialake:nav-rail-expanded";

// ── Nav items definition ──────────────────────────────────────────────────────

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  /** CASL permission required to show this item */
  permission?: { action: string; subject: string };
  /** Highlight if current path starts with this prefix */
  matchPrefix?: string;
  dividerBefore?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    key: "home",
    label: "nav.home",
    icon: <HomeIcon />,
    path: "/",
  },
  {
    key: "search",
    label: "nav.search",
    icon: <SearchIcon />,
    path: "/search",
    permission: { action: "view", subject: "asset" },
  },
  {
    key: "assets",
    label: "nav.assets",
    icon: <AssetsIcon />,
    path: "/assets",
    permission: { action: "view", subject: "asset" },
  },
  {
    key: "collections",
    label: "nav.collections",
    icon: <CollectionsIcon />,
    path: "/collections",
    matchPrefix: "/collections",
  },
  {
    key: "pipelines",
    label: "nav.pipelines",
    icon: <PipelinesIcon />,
    path: "/pipelines",
    matchPrefix: "/pipelines",
    permission: { action: "view", subject: "pipeline" },
  },
  {
    key: "executions",
    label: "nav.executions",
    icon: <ExecutionsIcon />,
    path: "/executions",
    permission: { action: "view", subject: "pipeline" },
  },
  {
    key: "settings",
    label: "nav.settings",
    icon: <SettingsIcon />,
    path: "/settings/profile",
    matchPrefix: "/settings",
    dividerBefore: true,
  },
];

// ── NavRailItem ───────────────────────────────────────────────────────────────

interface NavRailItemProps {
  item: NavItem;
  isActive: boolean;
  isExpanded: boolean;
  onClick: () => void;
}

const NavRailItem: React.FC<NavRailItemProps> = ({ item, isActive, isExpanded, onClick }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const label = t(item.label, item.key);

  const content = (
    <ListItemButton
      onClick={onClick}
      selected={isActive}
      aria-label={isExpanded ? undefined : label}
      sx={{
        minHeight: 44,
        borderRadius: 1.5,
        mx: 0.5,
        px: isExpanded ? 1.5 : 1,
        justifyContent: isExpanded ? "flex-start" : "center",
        transition: `all 0.2s ${springEasing}`,
        color: isActive ? "primary.main" : "text.secondary",
        "&.Mui-selected": {
          backgroundColor: alpha(theme.palette.primary.main, 0.1),
          color: "primary.main",
          "&:hover": {
            backgroundColor: alpha(theme.palette.primary.main, 0.15),
          },
        },
        "&:hover": {
          backgroundColor: alpha(theme.palette.action.active, 0.06),
        },
      }}
    >
      <ListItemIcon
        sx={{
          minWidth: isExpanded ? 36 : "unset",
          color: "inherit",
          "& svg": { fontSize: 22 },
          transition: `min-width 0.2s ${springEasing}`,
        }}
      >
        {item.icon}
      </ListItemIcon>
      {isExpanded && (
        <ListItemText
          primary={label}
          primaryTypographyProps={{
            variant: "body2",
            fontWeight: isActive ? 600 : 400,
            noWrap: true,
          }}
        />
      )}
    </ListItemButton>
  );

  if (!isExpanded) {
    return (
      <Tooltip title={label} placement="right" arrow>
        {content}
      </Tooltip>
    );
  }

  return content;
};

// ── NavRail ───────────────────────────────────────────────────────────────────

export const NavRail: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = usePermission();
  const { t } = useTranslation();

  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const isActive = (item: NavItem) => {
    if (item.matchPrefix) {
      return location.pathname.startsWith(item.matchPrefix);
    }
    return location.pathname === item.path;
  };

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.permission) return true;
    return can(item.permission.action as any, item.permission.subject as any);
  });

  const railWidth = isExpanded ? RAIL_EXPANDED_WIDTH : RAIL_COLLAPSED_WIDTH;

  return (
    <Box
      component="nav"
      aria-label={t("nav.mainNavigation", "Main navigation")}
      sx={{
        position: "fixed",
        top: `${layoutTokens.topBarHeight}px`,
        left: 0,
        bottom: 0,
        width: railWidth,
        zIndex: zIndexTokens.sidebar,
        backgroundColor: alpha(theme.palette.background.paper, 0.9),
        backdropFilter: "blur(8px)",
        borderRight: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
        display: "flex",
        flexDirection: "column",
        transition: `width 0.25s ${springEasing}`,
        overflow: "hidden",
      }}
    >
      {/* Nav items */}
      <List sx={{ flex: 1, pt: 1, pb: 0, px: 0 }} disablePadding>
        {visibleItems.map((item) => (
          <React.Fragment key={item.key}>
            {item.dividerBefore && (
              <Divider sx={{ my: 0.5, mx: 1, opacity: 0.5 }} />
            )}
            <NavRailItem
              item={item}
              isActive={isActive(item)}
              isExpanded={isExpanded}
              onClick={() => navigate(item.path)}
            />
          </React.Fragment>
        ))}
      </List>

      {/* Expand/collapse toggle */}
      <Box sx={{ p: 0.5, pb: 1 }}>
        <Tooltip
          title={isExpanded ? t("nav.collapse", "Collapse") : t("nav.expand", "Expand")}
          placement="right"
          arrow
        >
          <ListItemButton
            onClick={toggleExpanded}
            aria-label={isExpanded ? t("nav.collapse", "Collapse navigation") : t("nav.expand", "Expand navigation")}
            sx={{
              minHeight: 40,
              borderRadius: 1.5,
              mx: 0.5,
              justifyContent: isExpanded ? "flex-end" : "center",
              color: "text.disabled",
              "&:hover": { color: "text.secondary", backgroundColor: alpha(theme.palette.action.active, 0.06) },
            }}
          >
            <ListItemIcon sx={{ minWidth: "unset", color: "inherit", "& svg": { fontSize: 18 } }}>
              {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
            </ListItemIcon>
            {isExpanded && (
              <ListItemText
                primary={t("nav.collapse", "Collapse")}
                primaryTypographyProps={{ variant: "caption", noWrap: true }}
                sx={{ ml: 1 }}
              />
            )}
          </ListItemButton>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default NavRail;
