import React, { createContext, useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Button,
  IconButton,
  Box,
  useTheme,
} from "@mui/material";
import {
  Close as CloseIcon,
  WarningAmber as WarningIcon,
  ErrorOutline as DangerIcon,
  InfoOutlined as InfoIcon,
} from "@mui/icons-material";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConfirmationVariant = "danger" | "warning" | "info";

export interface ConfirmationOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmationVariant;
}

interface ConfirmationContextValue {
  confirm: (opts: ConfirmationOptions) => Promise<boolean>;
}

export const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

// ── Variant helpers ───────────────────────────────────────────────────────────

const VARIANT_CONFIG: Record<
  ConfirmationVariant,
  { icon: React.ReactNode; colorKey: "error" | "warning" | "info" }
> = {
  danger: { icon: <DangerIcon />, colorKey: "error" },
  warning: { icon: <WarningIcon />, colorKey: "warning" },
  info: { icon: <InfoIcon />, colorKey: "info" },
};

// ── Provider ──────────────────────────────────────────────────────────────────

export const ConfirmationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmationOptions>({
    title: "",
    variant: "danger",
  });

  // Resolver ref keeps the pending promise in scope across re-renders
  const resolverRef = useRef<(value: boolean) => void>(() => {});

  const confirm = useCallback((options: ConfirmationOptions): Promise<boolean> => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const handleClose = (confirmed: boolean) => {
    setOpen(false);
    resolverRef.current(confirmed);
  };

  const variant = opts.variant ?? "danger";
  const { icon, colorKey } = VARIANT_CONFIG[variant];
  const palette = theme.palette[colorKey];

  return (
    <ConfirmationContext.Provider value={{ confirm }}>
      {children}

      <Dialog
        open={open}
        onClose={() => handleClose(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            overflow: "hidden",
          },
        }}
      >
        {/* Colored accent strip at top */}
        <Box sx={{ height: 4, backgroundColor: palette.main }} />

        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            pt: 2.5,
            pb: 1,
            px: 3,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              sx={{
                color: palette.main,
                backgroundColor: alpha(palette.main, 0.1),
                borderRadius: "50%",
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                "& svg": { fontSize: 20 },
              }}
            >
              {icon}
            </Box>
            <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
              {opts.title}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={() => handleClose(false)}
            aria-label={t("common.close", "Close")}
            sx={{ mt: -0.5 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        {opts.description && (
          <DialogContent sx={{ px: 3, py: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {opts.description}
            </Typography>
          </DialogContent>
        )}

        <DialogActions sx={{ px: 3, pb: 2.5, pt: opts.description ? 2 : 1, gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => handleClose(false)}
            sx={{ minWidth: 80 }}
          >
            {opts.cancelLabel ?? t("common.cancel", "Cancel")}
          </Button>
          <Button
            variant="contained"
            size="small"
            color={colorKey}
            onClick={() => handleClose(true)}
            sx={{ minWidth: 80 }}
            autoFocus
          >
            {opts.confirmLabel ?? t("common.confirm", "Confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmationContext.Provider>
  );
};

export default ConfirmationProvider;
