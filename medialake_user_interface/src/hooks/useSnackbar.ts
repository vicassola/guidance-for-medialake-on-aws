import React from "react";
import { useSnackbar as useNotistack } from "notistack";

type Severity = "success" | "error" | "warning" | "info";

interface SnackbarOptions {
  message: string;
  severity?: Severity;
  autoHideDuration?: number;
  action?: React.ReactNode;
}

export const useSnackbar = () => {
  const { enqueueSnackbar, closeSnackbar } = useNotistack();

  const show = ({
    message,
    severity = "info",
    autoHideDuration = 3000,
    action,
  }: SnackbarOptions) => {
    enqueueSnackbar(message, { variant: severity, autoHideDuration, action });
  };

  return {
    show,
    // Convenience methods
    success: (message: string, opts?: Partial<SnackbarOptions>) =>
      show({ message, severity: "success", autoHideDuration: 3000, ...opts }),
    error: (message: string, opts?: Partial<SnackbarOptions>) =>
      show({ message, severity: "error", autoHideDuration: 5000, ...opts }),
    warning: (message: string, opts?: Partial<SnackbarOptions>) =>
      show({ message, severity: "warning", autoHideDuration: 4000, ...opts }),
    info: (message: string, opts?: Partial<SnackbarOptions>) =>
      show({ message, severity: "info", autoHideDuration: 3000, ...opts }),
    close: closeSnackbar,
    // Legacy compat
    showSnackbar: show,
    closeSnackbar,
  };
};
