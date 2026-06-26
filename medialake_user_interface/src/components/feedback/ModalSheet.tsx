import React from "react";
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Divider,
  useTheme,
  useMediaQuery,
  Slide,
} from "@mui/material";
import { Close as CloseIcon } from "@mui/icons-material";
import { alpha } from "@mui/material/styles";
import { zIndexTokens } from "@/theme/tokens";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModalSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Width on desktop (default 480px) */
  width?: number | string;
  children: React.ReactNode;
  /** Optional footer content (e.g., save/cancel buttons) */
  footer?: React.ReactNode;
  /** Disable closing on backdrop click */
  disableBackdropClose?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ModalSheet: React.FC<ModalSheetProps> = ({
  open,
  onClose,
  title,
  subtitle,
  width = 480,
  children,
  footer,
  disableBackdropClose = false,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const handleClose = (_event: object, reason: string) => {
    if (disableBackdropClose && reason === "backdropClick") return;
    onClose();
  };

  return (
    <Drawer
      anchor={isMobile ? "bottom" : "right"}
      open={open}
      onClose={handleClose}
      sx={{
        zIndex: zIndexTokens.modal,
        "& .MuiDrawer-paper": {
          width: isMobile ? "100%" : width,
          maxHeight: isMobile ? "90vh" : "100vh",
          borderTopLeftRadius: isMobile ? 16 : 0,
          borderTopRightRadius: isMobile ? 16 : 0,
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* Pull handle on mobile */}
      {isMobile && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            pt: 1.5,
            pb: 0.5,
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: alpha(theme.palette.text.secondary, 0.3),
            }}
          />
        </Box>
      )}

      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          px: 3,
          pt: isMobile ? 1.5 : 3,
          pb: 2,
          flexShrink: 0,
        }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton
          size="small"
          onClick={onClose}
          aria-label="Close panel"
          sx={{ mt: -0.5, ml: 1, flexShrink: 0 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Divider />

      {/* Scrollable content */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 3, py: 2.5 }}>{children}</Box>

      {/* Sticky footer */}
      {footer && (
        <>
          <Divider />
          <Box sx={{ px: 3, py: 2, flexShrink: 0 }}>{footer}</Box>
        </>
      )}
    </Drawer>
  );
};

export default ModalSheet;
