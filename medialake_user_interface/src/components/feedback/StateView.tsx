import React from "react";
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Skeleton,
  Alert,
  useTheme,
  Fade,
} from "@mui/material";
import {
  SearchOff as NoResultsIcon,
  ErrorOutline as ErrorIcon,
  InboxOutlined as EmptyIcon,
  Refresh as RetryIcon,
} from "@mui/icons-material";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

// ── Types ────────────────────────────────────────────────────────────────────

type LoadingVariant = "spinner" | "skeleton-list" | "skeleton-grid" | "inline";

interface LoadingState {
  state: "loading";
  variant?: LoadingVariant;
  rows?: number;
  message?: string;
}

interface ErrorState {
  state: "error";
  error: Error | string;
  onRetry?: () => void;
  compact?: boolean;
}

interface EmptyState {
  state: "empty";
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

interface NoResultsState {
  state: "no-results";
  query?: string;
  onClear?: () => void;
  description?: string;
}

type StateViewProps = LoadingState | ErrorState | EmptyState | NoResultsState;

// ── Loading views ─────────────────────────────────────────────────────────────

const SkeletonList: React.FC<{ rows: number }> = ({ rows }) => (
  <Box sx={{ width: "100%" }}>
    {Array.from({ length: rows }).map((_, i) => (
      <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1.5 }}>
        <Skeleton variant="rectangular" width={40} height={40} sx={{ borderRadius: 1, flexShrink: 0 }} />
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width="60%" height={20} />
          <Skeleton variant="text" width="40%" height={16} />
        </Box>
      </Box>
    ))}
  </Box>
);

const SkeletonGrid: React.FC<{ rows: number }> = ({ rows }) => (
  <Box
    sx={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
      gap: 2,
      width: "100%",
    }}
  >
    {Array.from({ length: rows }).map((_, i) => (
      <Box key={i}>
        <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 1.5, mb: 1 }} />
        <Skeleton variant="text" width="80%" />
        <Skeleton variant="text" width="50%" />
      </Box>
    ))}
  </Box>
);

const LoadingView: React.FC<LoadingState> = ({ variant = "spinner", rows = 6, message }) => {
  if (variant === "inline") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 2 }}>
        <CircularProgress size={18} thickness={4} />
        {message && <Typography variant="body2" color="text.secondary">{message}</Typography>}
      </Box>
    );
  }

  if (variant === "skeleton-list") return <SkeletonList rows={rows} />;
  if (variant === "skeleton-grid") return <SkeletonGrid rows={rows} />;

  return (
    <Fade in timeout={300}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
          gap: 2,
        }}
        role="status"
        aria-label={message ?? "Loading"}
        aria-live="polite"
      >
        <CircularProgress size={36} thickness={4} />
        {message && (
          <Typography variant="body2" color="text.secondary">
            {message}
          </Typography>
        )}
      </Box>
    </Fade>
  );
};

// ── Error view ────────────────────────────────────────────────────────────────

const ErrorView: React.FC<ErrorState> = ({ error, onRetry, compact }) => {
  const { t } = useTranslation();
  const errorMessage = typeof error === "string" ? error : error.message;

  if (compact) {
    return (
      <Alert
        severity="error"
        action={
          onRetry ? (
            <Button size="small" color="error" startIcon={<RetryIcon />} onClick={onRetry}>
              {t("common.retry", "Retry")}
            </Button>
          ) : undefined
        }
        sx={{ width: "100%" }}
      >
        {errorMessage}
      </Alert>
    );
  }

  return (
    <Fade in timeout={300}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
          gap: 2,
          textAlign: "center",
          px: 3,
        }}
        role="alert"
      >
        <ErrorIcon sx={{ fontSize: 48, color: "error.main", opacity: 0.8 }} />
        <Box>
          <Typography variant="h6" color="text.primary" gutterBottom>
            {t("common.errorOccurred", "Something went wrong")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
            {errorMessage}
          </Typography>
        </Box>
        {onRetry && (
          <Button
            variant="outlined"
            color="error"
            startIcon={<RetryIcon />}
            onClick={onRetry}
            size="small"
          >
            {t("common.retry", "Try again")}
          </Button>
        )}
      </Box>
    </Fade>
  );
};

// ── Empty view ────────────────────────────────────────────────────────────────

const EmptyView: React.FC<EmptyState> = ({ icon, title, description, action }) => {
  const theme = useTheme();

  return (
    <Fade in timeout={400}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
          gap: 2,
          textAlign: "center",
          px: 3,
        }}
      >
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "primary.main",
            "& svg": { fontSize: 32 },
          }}
        >
          {icon ?? <EmptyIcon />}
        </Box>
        <Box>
          <Typography variant="h6" color="text.primary" gutterBottom>
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
              {description}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
    </Fade>
  );
};

// ── No results view ───────────────────────────────────────────────────────────

const NoResultsView: React.FC<NoResultsState> = ({ query, onClear, description }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Fade in timeout={400}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
          gap: 2,
          textAlign: "center",
          px: 3,
        }}
      >
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            backgroundColor: alpha(theme.palette.text.secondary, 0.08),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "text.secondary",
            "& svg": { fontSize: 32 },
          }}
        >
          <NoResultsIcon />
        </Box>
        <Box>
          <Typography variant="h6" color="text.primary" gutterBottom>
            {query
              ? t("common.noResultsFor", 'No results for "{{query}}"', { query })
              : t("common.noResults", "No results found")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
            {description ?? t("common.noResultsHint", "Try different keywords or clear your filters")}
          </Typography>
        </Box>
        {onClear && (
          <Button variant="outlined" size="small" onClick={onClear}>
            {t("common.clearFilters", "Clear filters")}
          </Button>
        )}
      </Box>
    </Fade>
  );
};

// ── Main export ───────────────────────────────────────────────────────────────

export const StateView: React.FC<StateViewProps> = (props) => {
  switch (props.state) {
    case "loading":
      return <LoadingView {...props} />;
    case "error":
      return <ErrorView {...props} />;
    case "empty":
      return <EmptyView {...props} />;
    case "no-results":
      return <NoResultsView {...props} />;
  }
};

export default StateView;
