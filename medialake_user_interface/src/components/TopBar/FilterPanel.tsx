import React, { useCallback } from "react";
import {
  Box,
  Chip,
  Button,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Collapse,
  Divider,
  useTheme,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from "@mui/material";
import {
  ImageOutlined as ImageIcon,
  VideocamOutlined as VideoIcon,
  AudiotrackOutlined as AudioIcon,
  InsertDriveFileOutlined as DocIcon,
  DateRangeOutlined as DateIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  useSearchFilters,
  useDomainActions,
  useUIActions,
  useActiveFilterCount,
} from "@/stores/searchStore";

// ── Constants ─────────────────────────────────────────────────────────────────

const MEDIA_TYPES = [
  { value: "Image", label: "Image", icon: <ImageIcon sx={{ fontSize: 16 }} /> },
  { value: "Video", label: "Video", icon: <VideoIcon sx={{ fontSize: 16 }} /> },
  { value: "Audio", label: "Audio", icon: <AudioIcon sx={{ fontSize: 16 }} /> },
  { value: "Document", label: "Doc", icon: <DocIcon sx={{ fontSize: 16 }} /> },
] as const;

const DATE_OPTIONS = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
];

function getDateRange(option: string): { gte: string; lte: string } {
  const now = new Date();
  const lte = now.toISOString();
  const days = option === "24h" ? 1 : option === "7d" ? 7 : option === "14d" ? 14 : 30;
  const gte = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return { gte, lte };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface FilterPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called when "Advanced filters" is clicked — opens the full FilterModal */
  onAdvanced?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const FilterPanel: React.FC<FilterPanelProps> = ({ open, onClose, onAdvanced }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const filters = useSearchFilters();
  const { updateFilter, clearFilters } = useDomainActions();
  const { openFilterModal } = useUIActions();
  const activeCount = useActiveFilterCount();

  // ── Media type multi-toggle ───────────────────────────────────

  const selectedTypes = filters.type ? filters.type.split(",") : [];

  const handleTypeToggle = useCallback(
    (_: React.MouseEvent<HTMLElement>, newTypes: string[]) => {
      if (newTypes.length === 0) {
        updateFilter("type", undefined);
      } else {
        updateFilter("type", newTypes.join(","));
      }
    },
    [updateFilter]
  );

  // ── Date range ────────────────────────────────────────────────

  const selectedDate = filters.date_range_option ?? "";

  const handleDateChange = useCallback(
    (option: string) => {
      if (!option) {
        updateFilter("date_range_option", undefined);
        updateFilter("ingested_date_gte", undefined);
        updateFilter("ingested_date_lte", undefined);
        return;
      }
      const { gte, lte } = getDateRange(option);
      updateFilter("date_range_option", option);
      updateFilter("ingested_date_gte", gte);
      updateFilter("ingested_date_lte", lte);
    },
    [updateFilter]
  );

  // ── Render ────────────────────────────────────────────────────

  return (
    <Collapse in={open} unmountOnExit>
      <Box
        sx={{
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          backgroundColor: alpha(theme.palette.background.paper, 0.8),
          backdropFilter: "blur(8px)",
          px: 2,
          py: 1.5,
        }}
        role="region"
        aria-label={t("search.filterPanel", "Search filters")}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 2,
          }}
        >
          {/* Media type */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
              {t("search.filterPanel.type", "Type")}
            </Typography>
            <ToggleButtonGroup
              value={selectedTypes}
              onChange={handleTypeToggle}
              size="small"
              aria-label={t("search.filterPanel.mediaType", "Media type")}
              sx={{
                "& .MuiToggleButton-root": {
                  px: 1.25,
                  py: 0.4,
                  fontSize: "0.75rem",
                  gap: 0.5,
                  borderRadius: "6px !important",
                  border: `1px solid ${alpha(theme.palette.divider, 0.2)} !important`,
                  mx: 0.25,
                  "&.Mui-selected": {
                    backgroundColor: alpha(theme.palette.primary.main, 0.12),
                    color: "primary.main",
                    borderColor: `${alpha(theme.palette.primary.main, 0.3)} !important`,
                  },
                },
              }}
            >
              {MEDIA_TYPES.map((mt) => (
                <ToggleButton
                  key={mt.value}
                  value={mt.value}
                  aria-label={mt.label}
                  sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                >
                  {mt.icon}
                  {mt.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />

          {/* Date range */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
              {t("search.filterPanel.date", "Date")}
            </Typography>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <Select
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                displayEmpty
                renderValue={(val) =>
                  val ? DATE_OPTIONS.find((d) => d.value === val)?.label : t("search.filterPanel.anyDate", "Any date")
                }
                sx={{
                  fontSize: "0.75rem",
                  height: 30,
                  "& .MuiOutlinedInput-notchedOutline": {
                    borderColor: alpha(theme.palette.divider, 0.2),
                  },
                }}
              >
                <MenuItem value="">
                  <Typography variant="caption">{t("search.filterPanel.anyDate", "Any date")}</Typography>
                </MenuItem>
                {DATE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    <Typography variant="caption">{opt.label}</Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* Spacer */}
          <Box sx={{ flex: 1 }} />

          {/* Actions */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            {activeCount > 0 && (
              <Button
                size="small"
                startIcon={<ClearIcon sx={{ fontSize: 14 }} />}
                onClick={clearFilters}
                sx={{ fontSize: "0.75rem", py: 0.5 }}
              >
                {t("search.clearFilters", "Clear")} ({activeCount})
              </Button>
            )}
            {onAdvanced && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<FilterIcon sx={{ fontSize: 14 }} />}
                onClick={() => {
                  onAdvanced();
                  openFilterModal();
                }}
                sx={{ fontSize: "0.75rem", py: 0.5 }}
              >
                {t("search.filterPanel.advanced", "Advanced")}
              </Button>
            )}
          </Box>
        </Box>
      </Box>
    </Collapse>
  );
};

export default FilterPanel;
