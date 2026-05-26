import React, { useState, useMemo } from "react";
import { drawerWidth, collapsedDrawerWidth, layoutTokens, springEasing } from "@/constants";
import { Box, useTheme } from "@mui/material";
import { Outlet } from "react-router";
import { SidebarContext } from "../contexts/SidebarContext";
import { useDirection } from "../contexts/DirectionContext";
import { ChatProvider } from "../contexts/ChatContext";
import { alpha } from "@mui/material/styles";
import TopBar from "../TopBar";
import { ChatSidebar } from "../features/chat";
import { zIndexTokens } from "@/theme/tokens";

const AppLayout: React.FC = () => {
  // Keep SidebarContext state so PipelineToolbar (and other consumers) still work.
  // isCollapsed is fixed to true since there is no sidebar — consumers that
  // use it for width calculations will use collapsedDrawerWidth (72px).
  const [isCollapsed] = useState(true);
  const { direction } = useDirection();
  const isRTL = direction === "rtl";
  const theme = useTheme();

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
          <Box
            component="main"
            sx={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              position: "relative",
              minHeight: "100vh",
            }}
          >
            {/* Top Bar — full width, fixed */}
            <Box
              sx={{
                position: "fixed",
                top: 0,
                right: 0,
                left: 0,
                height: `${layoutTokens.topBarHeight}px`,
                zIndex: zIndexTokens.appBar,
                background: topBarGradient,
                backgroundColor: alpha(theme.palette.background.default, 0.85),
                backdropFilter: "blur(10px)",
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.06)}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Box sx={{ width: "100%", px: 2 }}>
                <TopBar />
              </Box>
            </Box>

            {/* Main Content Area */}
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
        {/* Chat Sidebar — outside the main layout flow */}
        <ChatSidebar />
      </ChatProvider>
    </SidebarContext.Provider>
  );
};

export default AppLayout;
