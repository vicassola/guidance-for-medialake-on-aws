import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Box,
  useTheme as useMuiTheme,
  InputBase,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Avatar,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  Collapse,
  Button as MuiButton,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { Button } from "@/components/common";
import {
  Search as SearchIcon,
  CloudUpload as CloudUploadIcon,
  FilterList as FilterListIcon,
  Chat as ChatIcon,
  Clear as ClearIcon,
  Close as CloseIcon,
  Home as HomeIcon,
  PermMedia as MediaAssetsIcon,
  Folder as FolderIcon,
  AccountTree as PipelineIcon,
  PlaylistPlay as ExecutionsIcon,
  Settings as SettingsIcon,
  AutoAwesome as ShowcaseIcon,
} from "@mui/icons-material";
import { signOut, fetchUserAttributes } from "aws-amplify/auth";
import { useAuth } from "./common/hooks/auth-context";
import { usePermission } from "./permissions";
import { useFeatureFlag } from "./contexts/FeatureFlagsContext";
import { useChat } from "./contexts/ChatContext";
import { useNavigate, useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import debounce from "lodash/debounce";
import { useTranslation } from "react-i18next";
import { useTheme } from "./hooks/useTheme";
import { useDirection } from "./contexts/DirectionContext";
import { S3UploaderModal } from "./features/upload";
import FilterModal from "./components/search/FilterModal";
import {
  useSearchFilters,
  useSearchQuery,
  useSemanticSearch,
  useDomainActions,
  useUIActions,
} from "./stores/searchStore";
import { NotificationCenter } from "./components/NotificationCenter";
import { QUERY_KEYS } from "./api/queryKeys";
import SemanticModeToggle from "./components/TopBar/SemanticModeToggle";
import SearchModeSelector from "./components/TopBar/SearchModeSelector";
import { useSemanticSearchStatus } from "./features/settings/system/hooks/useSystemSettings";
import { ThemeToggle } from "./components/ThemeToggle";
import logoFull from "./assets/images/Mediaset_Logo.png";

interface SearchTag {
  key: string;
  value: string;
}

function TopBar() {
  const muiTheme = useMuiTheme();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { direction } = useDirection();
  const isRTL = direction === "rtl";
  const { setIsAuthenticated } = useAuth();

  // ── Search state ──────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [searchTags, setSearchTags] = useState<SearchTag[]>([]);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  const storeQuery = useSearchQuery();
  const storeIsSemantic = useSemanticSearch();
  const filters = useSearchFilters();
  const { setQuery, setIsSemantic } = useDomainActions();
  const { openFilterModal } = useUIActions();
  const [searchResults, setSearchResults] = useState<any>(null);

  // ── Upload / Modals ────────────────────────────────────────────
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSemanticConfigDialogOpen, setIsSemanticConfigDialogOpen] = useState(false);

  // ── Chat ───────────────────────────────────────────────────────
  const isChatEnabled = useFeatureFlag("chat-enabled", true);
  const { toggleChat, isOpen: isChatOpen } = useChat();

  // ── Semantic search ────────────────────────────────────────────
  const { isSemanticSearchEnabled, isConfigured, providerData } = useSemanticSearchStatus();
  const isMarengo30 = providerData?.data?.searchProvider?.type === "twelvelabs-bedrock-3-0";

  // ── User info ──────────────────────────────────────────────────
  const [userInitial, setUserInitial] = useState("U");
  const [userName, setUserName] = useState("");
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);

  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const attributes = await fetchUserAttributes();
        if (attributes.given_name?.trim()) {
          setUserInitial(attributes.given_name.trim()[0].toUpperCase());
          setUserName(attributes.given_name.trim());
        } else if (attributes.email?.trim()) {
          setUserInitial(attributes.email.trim()[0].toUpperCase());
          setUserName(attributes.email.trim());
        }
      } catch (error) {
        console.error(t("app.errors.loadingUserAttributes", "Error loading user attributes:"), error);
      }
    };
    loadUserInfo();
  }, []);

  // ── Permissions ────────────────────────────────────────────────
  const { ability } = usePermission();

  const safePermissionCheck = useCallback(
    (action: string, resource: string) => {
      try {
        return ability?.can(action as any, resource as any) ?? false;
      } catch {
        return false;
      }
    },
    [ability]
  );

  const canViewPipeline = useMemo(
    () => { try { return ability?.can("view", "pipeline") ?? false; } catch { return false; } },
    [ability]
  );

  const canViewSettings = useMemo(
    () => safePermissionCheck("view", "settings-menu"),
    [safePermissionCheck]
  );

  const canViewReview = useMemo(
    () => safePermissionCheck("view", "reviews"),
    [safePermissionCheck]
  );

  // ── Settings dropdown ──────────────────────────────────────────
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);

  const settingsSubItems = [
    { text: t("sidebar.submenu.connectors"), path: "/settings/connectors" },
    { text: t("sidebar.submenu.usersAndGroups", "Users and Groups"), path: "/settings/users" },
    { text: t("sidebar.submenu.permissions", "Permissions"), path: "/settings/permissions" },
    { text: t("sidebar.submenu.integrations"), path: "/settings/integrations" },
    { text: t("sidebar.submenu.system"), path: "/settings/system" },
  ];

  // ── Nav items ──────────────────────────────────────────────────
  const navItems = useMemo(() => {
    const items = [
      { text: t("sidebar.menu.home"), icon: <HomeIcon fontSize="small" />, path: "/" },
      ...(canViewReview
        ? [{ text: "Review", icon: <ShowcaseIcon fontSize="small" />, path: "/review", badge: "DEMO" }]
        : []),
      { text: t("sidebar.menu.assets"), icon: <MediaAssetsIcon fontSize="small" />, path: "/assets" },
      { text: t("sidebar.menu.collections"), icon: <FolderIcon fontSize="small" />, path: "/collections" },
      ...(canViewPipeline
        ? [
            { text: t("sidebar.menu.pipelines"), icon: <PipelineIcon fontSize="small" />, path: "/pipelines" },
            { text: t("sidebar.menu.pipelineExecutions"), icon: <ExecutionsIcon fontSize="small" />, path: "/executions" },
          ]
        : []),
    ];
    return items;
  }, [t, canViewPipeline, canViewReview]);

  // ── Auto-expand search on /search page ────────────────────────
  useEffect(() => {
    if (location.pathname === "/search") {
      setIsSearchExpanded(true);
    }
  }, [location.pathname]);

  // Focus input when search expands
  useEffect(() => {
    if (isSearchExpanded) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isSearchExpanded]);

  // ── Search logic (unchanged from original) ────────────────────
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const semanticParam = params.get("semantic") === "true";
    if (semanticParam !== storeIsSemantic) {
      setIsSemantic(semanticParam);
    }
  }, []);

  useEffect(() => {
    if (location.pathname === "/search" && storeQuery && storeQuery !== searchInput) {
      setSearchInput(storeQuery);
    }
  }, [location.pathname, storeQuery]);

  const getSearchQuery = useCallback(() => {
    const tagPart = searchTags.map((tag) => `${tag.key}: ${tag.value}`).join(" ");
    return `${tagPart}${tagPart && searchInput ? " " : ""}${searchInput}`.trim();
  }, [searchTags, searchInput]);

  const debouncedSearch = useCallback(
    debounce((query: string) => {
      if (query.trim()) {
        setQuery(query);
        setIsSemantic(storeIsSemantic);

        const facetParams = {
          type: filters.type,
          extension: filters.extension,
          asset_size_gte: filters.asset_size_gte,
          asset_size_lte: filters.asset_size_lte,
          ingested_date_gte: filters.ingested_date_gte,
          ingested_date_lte: filters.ingested_date_lte,
          filename: filters.filename,
        };
        Object.keys(facetParams).forEach((key) => {
          if (facetParams[key as keyof typeof facetParams] === undefined) {
            delete facetParams[key as keyof typeof facetParams];
          }
        });

        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.SEARCH.list(query, 1, 50, storeIsSemantic, [], facetParams),
        });

        const params = new URLSearchParams();
        params.set("q", query);
        params.set("semantic", storeIsSemantic.toString());
        if (filters.type) params.set("type", filters.type);
        if (filters.extension) params.set("extension", filters.extension);
        if (filters.asset_size_gte) params.set("asset_size_gte", filters.asset_size_gte.toString());
        if (filters.asset_size_lte) params.set("asset_size_lte", filters.asset_size_lte.toString());
        if (filters.ingested_date_gte) params.set("ingested_date_gte", filters.ingested_date_gte);
        if (filters.ingested_date_lte) params.set("ingested_date_lte", filters.ingested_date_lte);
        if (filters.filename) params.set("filename", filters.filename);

        navigate(`/search?${params.toString()}`);
      }
    }, 500),
    [navigate, storeIsSemantic, setQuery, setIsSemantic, filters, queryClient]
  );

  useEffect(() => {
    const handleStorageChange = () => {
      const storedResults = sessionStorage.getItem("searchResults");
      if (storedResults) {
        try {
          setSearchResults(JSON.parse(storedResults));
        } catch (e) {
          console.error("Error parsing search results from session storage", e);
        }
      }
    };
    handleStorageChange();
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const createTagFromInput = (input: string): boolean => {
    if (input.includes(":")) {
      const [key, ...valueParts] = input.split(":");
      const value = valueParts.join(":").trim();
      if (key && value) {
        const newTag: SearchTag = { key: key.trim(), value };
        setSearchTags((prev) => [...prev, newTag]);
        setSearchInput("");
        const searchQuery = getSearchQuery();

        const facetParams = {
          type: filters.type,
          extension: filters.extension,
          asset_size_gte: filters.asset_size_gte,
          asset_size_lte: filters.asset_size_lte,
          ingested_date_gte: filters.ingested_date_gte,
          ingested_date_lte: filters.ingested_date_lte,
          filename: filters.filename,
        };
        Object.keys(facetParams).forEach((key) => {
          if (facetParams[key as keyof typeof facetParams] === undefined) {
            delete facetParams[key as keyof typeof facetParams];
          }
        });

        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.SEARCH.list(searchQuery, 1, 50, storeIsSemantic, [], facetParams),
        });

        const params = new URLSearchParams();
        params.set("q", searchQuery);
        params.set("semantic", storeIsSemantic.toString());
        navigate(`/search?${params.toString()}`);
        return true;
      }
    }
    return false;
  };

  const handleSearchInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearchInput(value);
    if (value.endsWith(" ") && value.includes(":")) {
      const potentialTag = value.trim();
      if (createTagFromInput(potentialTag)) return;
    }
    if (!value.includes(":")) {
      const currentQuery = value.trim()
        ? `${searchTags.map((tag) => `${tag.key}: ${tag.value}`).join(" ")}${
            searchTags.length > 0 ? " " : ""
          }${value}`
        : searchTags.map((tag) => `${tag.key}: ${tag.value}`).join(" ");
      debouncedSearch(currentQuery);
    }
  };

  const handleSearchKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearchSubmit();
    }
    if (event.key === "Escape") {
      if (location.pathname !== "/search") setIsSearchExpanded(false);
    }
  };

  const handleSearchSubmit = () => {
    if (searchInput.includes(":")) {
      createTagFromInput(searchInput);
    } else if (searchInput.trim() || searchTags.length > 0) {
      const searchQuery = getSearchQuery();
      setQuery(searchQuery);
      setIsSemantic(storeIsSemantic);

      const facetParams = {
        type: filters.type,
        extension: filters.extension,
        asset_size_gte: filters.asset_size_gte,
        asset_size_lte: filters.asset_size_lte,
        ingested_date_gte: filters.ingested_date_gte,
        ingested_date_lte: filters.ingested_date_lte,
        filename: filters.filename,
      };
      Object.keys(facetParams).forEach((key) => {
        if (facetParams[key as keyof typeof facetParams] === undefined) {
          delete facetParams[key as keyof typeof facetParams];
        }
      });

      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.SEARCH.list(searchQuery, 1, 50, storeIsSemantic, [], facetParams),
      });

      const params = new URLSearchParams();
      params.set("q", searchQuery);
      params.set("semantic", storeIsSemantic.toString());
      if (filters.type) params.set("type", filters.type);
      if (filters.extension) params.set("extension", filters.extension);
      if (filters.asset_size_gte) params.set("asset_size_gte", filters.asset_size_gte.toString());
      if (filters.asset_size_lte) params.set("asset_size_lte", filters.asset_size_lte.toString());
      if (filters.ingested_date_gte) params.set("ingested_date_gte", filters.ingested_date_gte);
      if (filters.ingested_date_lte) params.set("ingested_date_lte", filters.ingested_date_lte);
      if (filters.filename) params.set("filename", filters.filename);

      navigate(`/search?${params.toString()}`);
      setSearchInput("");
    }
  };

  const handleDeleteTag = (tagToDelete: SearchTag) => {
    setSearchTags((prev) => {
      const newTags = prev.filter(
        (tag) => !(tag.key === tagToDelete.key && tag.value === tagToDelete.value)
      );
      const searchQuery = newTags.map((tag) => `${tag.key}: ${tag.value}`).join(" ");

      const facetParams = {
        type: filters.type,
        extension: filters.extension,
        asset_size_gte: filters.asset_size_gte,
        asset_size_lte: filters.asset_size_lte,
        ingested_date_gte: filters.ingested_date_gte,
        ingested_date_lte: filters.ingested_date_lte,
        filename: filters.filename,
      };
      Object.keys(facetParams).forEach((key) => {
        if (facetParams[key as keyof typeof facetParams] === undefined) {
          delete facetParams[key as keyof typeof facetParams];
        }
      });

      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.SEARCH.list(searchQuery, 1, 50, storeIsSemantic, [], facetParams),
      });

      const params = new URLSearchParams();
      params.set("q", searchQuery);
      params.set("semantic", storeIsSemantic.toString());
      navigate(`/search?${params.toString()}`);
      return newTags;
    });
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setSearchTags([]);
  };

  const handleSemanticSearchToggle = (
    event: React.MouseEvent | React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!isSemanticSearchEnabled || !isConfigured) {
      setIsSemanticConfigDialogOpen(true);
      return;
    }
    let newValue: boolean;
    if ("checked" in (event.target as HTMLInputElement)) {
      newValue = (event.target as HTMLInputElement).checked;
    } else {
      newValue = !storeIsSemantic;
    }
    setIsSemantic(newValue);
    if (location.pathname === "/search") {
      const params = new URLSearchParams(location.search);
      params.set("semantic", newValue.toString());
      navigate(`/search?${params.toString()}`, { replace: true });
    }
  };

  const handleCloseSemanticConfigDialog = () => setIsSemanticConfigDialogOpen(false);
  const handleNavigateToSettings = () => {
    setIsSemanticConfigDialogOpen(false);
    navigate("/settings/system");
  };
  const handleUploadComplete = (_files: any[]) => handleCloseUploadModal();
  const handleCloseUploadModal = () => setIsUploadModalOpen(false);
  const handleOpenFilterModal = () => openFilterModal();

  const handleLogout = async () => {
    try {
      await signOut();
      setIsAuthenticated(false);
      navigate("/sign-in");
    } catch (error) {
      console.error(t("app.errors.signingOut", "Error signing out:"), error);
    }
    setUserMenuAnchor(null);
  };

  const hasActiveFilters = Object.keys(filters).filter((k) => k !== "date_range_option").length > 0;

  const isNavActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        gap: 1,
      }}
    >
      {/* Logo */}
      <Box
        component="img"
        src={logoFull}
        alt="Mediaset"
        sx={{
          height: 36,
          width: "auto",
          objectFit: "contain",
          flexShrink: 0,
          mr: 1,
          cursor: "pointer",
        }}
        onClick={() => navigate("/")}
      />

      {/* Horizontal nav items — hidden when search is expanded */}
      {!isSearchExpanded && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            flexShrink: 0,
          }}
        >
          {navItems.map((item) => (
            <MuiButton
              key={item.path}
              variant="text"
              size="small"
              onClick={() => navigate(item.path)}
              sx={{
                px: 1.5,
                py: 0.75,
                minWidth: 0,
                fontWeight: isNavActive(item.path) ? 700 : 400,
                color: isNavActive(item.path)
                  ? muiTheme.palette.primary.main
                  : muiTheme.palette.text.secondary,
                borderBottom: isNavActive(item.path)
                  ? `2px solid ${muiTheme.palette.primary.main}`
                  : "2px solid transparent",
                borderRadius: 0,
                fontSize: "0.875rem",
                textTransform: "none",
                whiteSpace: "nowrap",
                "&:hover": {
                  backgroundColor: alpha(muiTheme.palette.primary.main, 0.06),
                  color: muiTheme.palette.text.primary,
                },
              }}
            >
              {item.text}
              {"badge" in item && (item as any).badge && (
                <Chip
                  label={(item as any).badge}
                  size="small"
                  color="error"
                  sx={{
                    ml: 0.5,
                    height: 16,
                    fontSize: "0.55rem",
                    fontWeight: 700,
                    "& .MuiChip-label": { px: 0.5 },
                  }}
                />
              )}
            </MuiButton>
          ))}

          {/* Settings dropdown */}
          {canViewSettings && (
            <>
              <MuiButton
                variant="text"
                size="small"
                onClick={(e) => setSettingsAnchor(e.currentTarget)}
                sx={{
                  px: 1.5,
                  py: 0.75,
                  minWidth: 0,
                  fontWeight: location.pathname.startsWith("/settings") ? 700 : 400,
                  color: location.pathname.startsWith("/settings")
                    ? muiTheme.palette.primary.main
                    : muiTheme.palette.text.secondary,
                  borderBottom: location.pathname.startsWith("/settings")
                    ? `2px solid ${muiTheme.palette.primary.main}`
                    : "2px solid transparent",
                  borderRadius: 0,
                  fontSize: "0.875rem",
                  textTransform: "none",
                  whiteSpace: "nowrap",
                  "&:hover": {
                    backgroundColor: alpha(muiTheme.palette.primary.main, 0.06),
                    color: muiTheme.palette.text.primary,
                  },
                }}
              >
                {t("sidebar.menu.settings")}
              </MuiButton>
              <Menu
                anchorEl={settingsAnchor}
                open={Boolean(settingsAnchor)}
                onClose={() => setSettingsAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                transformOrigin={{ vertical: "top", horizontal: "left" }}
              >
                {settingsSubItems.map((sub) => (
                  <MenuItem
                    key={sub.path}
                    onClick={() => {
                      navigate(sub.path);
                      setSettingsAnchor(null);
                    }}
                    selected={location.pathname === sub.path}
                    sx={{ fontSize: "0.875rem" }}
                  >
                    {sub.text}
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}
        </Box>
      )}

      {/* Spacer */}
      <Box sx={{ flex: 1 }} />

      {/* Search — collapsed icon or expanded pill */}
      {isSearchExpanded ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flex: 1,
            maxWidth: 700,
          }}
        >
          {/* Tags */}
          {searchTags.map((tag, index) => (
            <Chip
              key={index}
              label={`${tag.key}: ${tag.value}`}
              onDelete={() => handleDeleteTag(tag)}
              size="small"
              sx={{
                backgroundColor: muiTheme.palette.primary.light,
                color: muiTheme.palette.primary.contrastText,
                "& .MuiChip-deleteIcon": { color: muiTheme.palette.primary.contrastText },
                flexShrink: 0,
              }}
            />
          ))}

          {/* Search pill */}
          <Box
            ref={searchBoxRef}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor:
                isDark
                  ? alpha(muiTheme.palette.background.paper, 0.85)
                  : muiTheme.palette.background.paper,
              borderRadius: "9999px",
              padding: "5px 6px",
              minHeight: 40,
              flex: 1,
              flexDirection: isRTL ? "row-reverse" : "row",
              border: `1px solid ${alpha(muiTheme.palette.divider, isDark ? 0.12 : 0.1)}`,
              boxShadow: isDark
                ? `0 1px 3px ${alpha(muiTheme.palette.common.black, 0.4)}`
                : `0 1px 3px ${alpha(muiTheme.palette.common.black, 0.08)}`,
              "&:focus-within": {
                borderColor: alpha(muiTheme.palette.primary.main, 0.5),
                boxShadow: `0 0 0 2px ${alpha(muiTheme.palette.primary.main, isDark ? 0.25 : 0.15)}`,
              },
            }}
          >
            <SemanticModeToggle isVisible={storeIsSemantic} />

            <InputBase
              inputRef={searchInputRef}
              placeholder={
                storeIsSemantic
                  ? t("search.bar.placeholderSemantic", "Search (e.g., a peaceful place)")
                  : t("search.bar.placeholder", "Search (e.g., mountains)")
              }
              value={searchInput}
              onChange={handleSearchInputChange}
              onKeyUp={handleSearchKeyPress}
              fullWidth
              sx={{
                fontSize: "14px",
                color: muiTheme.palette.text.primary,
                [isRTL ? "mr" : "ml"]: storeIsSemantic ? 0 : 1.5,
                "& input": {
                  padding: "8px 0",
                  "&::placeholder": { color: muiTheme.palette.text.disabled, opacity: 1 },
                },
              }}
            />

            {searchInput && (
              <IconButton
                size="small"
                onClick={handleClearSearch}
                sx={{
                  color: alpha(muiTheme.palette.text.secondary, 0.6),
                  padding: "4px",
                  flexShrink: 0,
                  "&:hover": { backgroundColor: "transparent", color: muiTheme.palette.text.secondary },
                }}
              >
                <ClearIcon sx={{ fontSize: "18px" }} />
              </IconButton>
            )}

            <Box sx={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, [isRTL ? "ml" : "mr"]: "1px" }}>
              {/* Semantic toggle */}
              <Box sx={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0 }}>
                <Box
                  component="span"
                  sx={{ fontSize: "12px", fontWeight: 500, color: alpha(muiTheme.palette.text.secondary, 0.7), userSelect: "none", lineHeight: 1, whiteSpace: "nowrap" }}
                >
                  {t("search.semantic.label", "Semantic")}
                </Box>
                <Box
                  role="switch"
                  aria-checked={storeIsSemantic}
                  tabIndex={0}
                  onClick={handleSemanticSearchToggle}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSemanticSearchToggle(e as unknown as React.MouseEvent);
                    }
                  }}
                  sx={{
                    width: 34, height: 19, borderRadius: "10px",
                    backgroundColor: storeIsSemantic
                      ? muiTheme.palette.primary.main
                      : alpha(muiTheme.palette.action.active, isDark ? 0.18 : 0.14),
                    position: "relative", cursor: "pointer", transition: "background-color 0.2s", flexShrink: 0,
                    "&:hover": {
                      backgroundColor: storeIsSemantic
                        ? muiTheme.palette.primary.dark
                        : alpha(muiTheme.palette.action.active, isDark ? 0.25 : 0.2),
                    },
                    "&:focus-visible": { outline: `2px solid ${muiTheme.palette.primary.main}`, outlineOffset: "2px" },
                    "&::after": {
                      content: '""', position: "absolute", top: "2px",
                      left: storeIsSemantic ? "17px" : "2px",
                      width: 15, height: 15, borderRadius: "50%",
                      backgroundColor: muiTheme.palette.common.white,
                      boxShadow: `0 1px 2px ${alpha(muiTheme.palette.common.black, 0.2)}`,
                      transition: "left 0.2s ease",
                    },
                  }}
                />
              </Box>

              <Box sx={{ width: "1px", height: 16, backgroundColor: alpha(muiTheme.palette.divider, isDark ? 0.15 : 0.12), flexShrink: 0 }} />

              {/* Filter */}
              <IconButton
                size="small"
                onClick={handleOpenFilterModal}
                sx={{
                  color: hasActiveFilters ? muiTheme.palette.primary.main : alpha(muiTheme.palette.text.secondary, 0.7),
                  padding: "5px", flexShrink: 0, position: "relative",
                  "&:hover": { backgroundColor: alpha(muiTheme.palette.action.active, 0.06) },
                }}
              >
                <FilterListIcon sx={{ fontSize: "20px" }} />
                {hasActiveFilters && (
                  <Box sx={{
                    position: "absolute", top: -3, right: -3,
                    backgroundColor: muiTheme.palette.primary.main,
                    color: muiTheme.palette.primary.contrastText,
                    borderRadius: "50%", width: 14, height: 14,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.55rem", fontWeight: 700, lineHeight: 1,
                    border: `2px solid ${muiTheme.palette.background.paper}`, boxSizing: "content-box",
                  }}>
                    {Object.keys(filters).filter((k) => k !== "date_range_option").length}
                  </Box>
                )}
              </IconButton>

              <SearchModeSelector isVisible={storeIsSemantic && isMarengo30} />

              {/* Search submit */}
              <IconButton
                onClick={handleSearchSubmit}
                sx={{
                  backgroundColor: muiTheme.palette.primary.main,
                  color: muiTheme.palette.primary.contrastText,
                  width: 34, height: 34, flexShrink: 0,
                  "&:hover": { backgroundColor: muiTheme.palette.primary.dark },
                  "&:active": { transform: "scale(0.94)" },
                }}
              >
                <SearchIcon sx={{ fontSize: "18px" }} />
              </IconButton>
            </Box>
          </Box>

          {/* Close search (only when not on /search page) */}
          {location.pathname !== "/search" && (
            <Tooltip title={t("common.close", "Close")}>
              <IconButton
                size="small"
                onClick={() => setIsSearchExpanded(false)}
                sx={{ color: muiTheme.palette.text.secondary, flexShrink: 0 }}
              >
                <CloseIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      ) : (
        /* Collapsed search — just the magnifying glass icon */
        <Tooltip title={t("common.search", "Search")}>
          <IconButton
            size="small"
            onClick={() => setIsSearchExpanded(true)}
            sx={{
              color: muiTheme.palette.text.secondary,
              backgroundColor: alpha(muiTheme.palette.action.active, isDark ? 0.1 : 0.04),
              borderRadius: "8px",
              padding: "8px",
              "&:hover": { backgroundColor: alpha(muiTheme.palette.action.active, isDark ? 0.2 : 0.08) },
            }}
          >
            <SearchIcon />
          </IconButton>
        </Tooltip>
      )}

      {/* Right-side icons */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, ml: 0.5 }}>
        {/* Upload */}
        <Tooltip title={t("upload.title", "Upload")}>
          <IconButton
            size="small"
            onClick={() => setIsUploadModalOpen(true)}
            sx={{
              color: muiTheme.palette.text.secondary,
              backgroundColor: alpha(muiTheme.palette.action.active, isDark ? 0.1 : 0.04),
              borderRadius: "8px",
              padding: "8px",
              "&:hover": { backgroundColor: alpha(muiTheme.palette.action.active, isDark ? 0.2 : 0.08) },
            }}
          >
            <CloudUploadIcon />
          </IconButton>
        </Tooltip>

        {/* Notifications */}
        <NotificationCenter />

        {/* Chat */}
        {isChatEnabled && (
          <Tooltip title={t("chat.title", "Chat")}>
            <IconButton
              size="small"
              onClick={toggleChat}
              sx={{
                color: isChatOpen ? muiTheme.palette.primary.main : muiTheme.palette.text.secondary,
                backgroundColor: isChatOpen
                  ? alpha(muiTheme.palette.primary.main, 0.1)
                  : alpha(muiTheme.palette.action.active, isDark ? 0.1 : 0.04),
                borderRadius: "8px",
                padding: "8px",
                "&:hover": {
                  backgroundColor: isChatOpen
                    ? alpha(muiTheme.palette.primary.main, 0.2)
                    : alpha(muiTheme.palette.action.active, isDark ? 0.2 : 0.08),
                },
              }}
            >
              <ChatIcon />
            </IconButton>
          </Tooltip>
        )}

        {/* Theme toggle */}
        <ThemeToggle />

        {/* User avatar */}
        <Tooltip title={userName || t("user.profile", "Profile")}>
          <Avatar
            onClick={(e) => setUserMenuAnchor(e.currentTarget)}
            sx={{
              width: 32,
              height: 32,
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
              backgroundColor: muiTheme.palette.primary.main,
              "&:hover": { backgroundColor: muiTheme.palette.primary.dark },
            }}
          >
            {userInitial}
          </Avatar>
        </Tooltip>
        <Menu
          anchorEl={userMenuAnchor}
          open={Boolean(userMenuAnchor)}
          onClose={() => setUserMenuAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          {userName && (
            <MenuItem disabled sx={{ opacity: "1 !important" }}>
              <Typography variant="body2" fontWeight={600}>{userName}</Typography>
            </MenuItem>
          )}
          <MenuItem onClick={handleLogout}>{t("sidebar.logout", "Logout")}</MenuItem>
        </Menu>
      </Box>

      {/* Modals */}
      <S3UploaderModal
        open={isUploadModalOpen}
        onClose={handleCloseUploadModal}
        onUploadComplete={handleUploadComplete}
        title={t("upload.title", "Upload Media Files")}
        description={t(
          "upload.description",
          "Select an S3 connector and upload your media files. Only audio, video, HLS, and MPEG-DASH formats are supported."
        )}
      />

      <FilterModal facetCounts={searchResults?.data?.searchMetadata?.facets} />

      <Dialog open={isSemanticConfigDialogOpen} onClose={handleCloseSemanticConfigDialog}>
        <DialogTitle>{t("search.semantic.configDialog.title", "Semantic Search Not Configured")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t(
              "search.semantic.configDialog.description",
              "Semantic search is currently not configured or disabled. To enable this feature, go to System Settings > Search to configure a search provider, or press the button below."
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseSemanticConfigDialog} color="inherit">
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={handleNavigateToSettings} variant="contained" color="primary" autoFocus>
            {t("search.semantic.configDialog.goToSettings", "Go to Search Settings")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default TopBar;
