import React, { useState, useMemo } from "react";
import { layoutTokens, springEasing } from "@/constants";
import { Box, useTheme } from "@mui/material";
import { Outlet } from "react-router";
import { SidebarContext } from "../contexts/SidebarContext";
import { useDirection } from "../contexts/DirectionContext";
import { ChatProvider } from "../contexts/ChatContext";
import { alpha } from "@mui/material/styles";
import TopBar from "../TopBar";
import { ChatSidebar } from "../features/chat";
import { zIndexTokens } from "@/theme/tokens";
import { NavRail } from "./layout/NavRail";

// Width of the NavRail when collapsed (matches NavRail constant)
const NAV_RAIL_COLLAPSED = 56;
const NAV_RAIL_EXPANDED = 200;

// Storage key kept in sync with NavRail.tsx
const STORAGE_KEY = "medialake:nav-rail-expanded";

const AppLayout: React.FC = () => {
  // SidebarContext is kept alive so PipelineToolbar and other consumers
  // that check isCollapsed for width calculations still work.
  const [isCollapsed] = useState(true);
  const { direction } = useDirection();
  const isRTL = direction === "rtl";
  const theme = useTheme();

  // Mirror the NavRail expanded state so the content area shifts correctly
  const [isNavExpanded, setIsNavExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Listen for localStorage changes from NavRail (same tab)
  React.useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setIsNavExpanded(e.newValue === "true");
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Poll localStorage for same-tab changes (storage event only fires for other tabs)
  React.useEffect(() => {
    let last = localStorage.getItem(STORAGE_KEY);
    const id = setInterval(() => {
      const curr = localStorage.getItem(STORAGE_KEY);
      if (curr !== last) {
        last = curr;
        setIsNavExpanded(curr === "true");
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  const navWidth = isNavExpanded ? NAV_RAIL_EXPANDED : NAV_RAIL_COLLAPSED;

  const gradientBackground = useMemo(
    () => `
      radial-gradient(ellipse at top, ${alpha(
        theme.palette.primary.main,
        0.08
      )} 0%, transparent 50%),
      radial-gradient(ellipse at bottom, ${alpha(
        theme.palette.secondary.main,
        0.05
      )} 0%, transparent 50%),
      linear-gradient(135deg, ${theme.palette.background.default} 0%, ${alpha(
        theme.palette.primary.main,
        0.02
      )} 100%)
    `,
    [theme.palette.primary.main, theme.palette.secondary.main, theme.palette.background.default]
  );

  const topBarGradient = useMemo(
    () => `
      radial-gradient(ellipse at top, ${alpha(
        theme.palette.primary.main,
        0.08
      )} 0%, transparent 50%),
      linear-gradient(135deg, ${theme.palette.background.default} 0%, ${alpha(
        theme.palette.primary.main,
        0.02
      )} 100%)
    `,
    [theme.palette.primary.main, theme.palette.background.default]
  );

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed: () => {} }}>
      <ChatProvider>
        <Box
          sx={{
            display: "flex",
            flexDirection: isRTL ? "row-reverse" : "row",
            minHeight: "100vh",
            background: gradientBackground,
          }}
        >
          {/* NavRail — fixed position, manages its own width */}
          <NavRail />

          {/* Main area shifts right to clear the rail */}
          <Box
            component="main"
            sx={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              position: "relative",
              minHeight: "100vh",
              [isRTL ? "mr" : "ml"]: `${navWidth}px`,
              transition: `margin-left 0.25s ${springEasing}`,
            }}
          >
            {/* Top Bar — full width, fixed */}
            <Box
              sx={{
                position: "fixed",
                top: 0,
                right: 0,
                left: `${navWidth}px`,
                height: `${layoutTokens.topBarHeight}px`,
                zIndex: zIndexTokens.appBar,
                background: topBarGradient,
                backgroundColor: alpha(theme.palette.background.default, 0.85),
                backdropFilter: "blur(10px)",
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.06)}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: `left 0.25s ${springEasing}`,
              }}
            >
              <Box sx={{ width: "100%", px: 2 }}>
                <TopBar />
              </Box>
            </Box>

            {/* Page content */}
            <Box
              sx={{
                flexGrow: 1,
                px: layoutTokens.pagePadding,
                py: 3,
                mt: `${layoutTokens.topBarHeight}px`,
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                overflow: "auto",
                backgroundColor: "transparent",
              }}
            >
              <Outlet />
            </Box>
          </Box>
        </Box>

        {/* Chat Sidebar — outside main layout flow */}
        <ChatSidebar />
      </ChatProvider>
    </SidebarContext.Provider>
  );
};

export default AppLayout;
