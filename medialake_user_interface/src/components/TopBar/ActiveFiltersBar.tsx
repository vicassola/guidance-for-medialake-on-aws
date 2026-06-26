import React from "react";
import { Box, Chip, Typography, Collapse, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useSearchFilters, useDomainActions, useActiveFilterCount } from "@/stores/searchStore";
import { FacetFilters } from "@/types/facetSearch";

// ── Label helpers ─────────────────────────────────────────────────────────────

function formatFilterLabel(key: keyof FacetFilters, value: string | number): string {
  switch (key) {
    case "type":
      return `Type: ${value}`;
    case "extension":
      return `Ext: ${value}`;
    case "date_range_option":
      return `Date: ${value}`;
    case "ingested_date_gte":
      return `From: ${new Date(value as string).toLocaleDateString()}`;
    case "ingested_date_lte":
      return `To: ${new Date(value as string).toLocaleDateString()}`;
    case "asset_size_gte": {
      const mb = Math.round(Number(value) / (1024 * 1024));
      return `Min: ${mb}MB`;
    }
    case "asset_size_lte": {
      const mb = Math.round(Number(value) / (1024 * 1024));
      return `Max: ${mb}MB`;
    }
    case "filename":
      return `File: ${value}`;
    default:
      return `${key}: ${value}`;
  }
}

// Keys that are "internal" and should not render individual chips
// (date_range_option is represented by ingested_date_gte/lte chips)
const SKIP_KEYS = new Set<keyof FacetFilters>(["date_range_option"]);

// ── Component ─────────────────────────────────────────────────────────────────

export const ActiveFiltersBar: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const filters = useSearchFilters();
  const { updateFilter, clearFilters } = useDomainActions();
  const activeCount = useActiveFilterCount();

  const filterEntries = Object.entries(filters).filter(
    ([k, v]) => !SKIP_KEYS.has(k as keyof FacetFilters) && v !== undefined && v !== ""
  ) as [keyof FacetFilters, string | number][];

  const handleRemove = (key: keyof FacetFilters) => {
    // When removing a date field, also clear the companion and the range option
    if (key === "ingested_date_gte" || key === "ingested_date_lte") {
      updateFilter("ingested_date_gte", undefined);
      updateFilter("ingested_date_lte", undefined);
      updateFilter("date_range_option", undefined);
    } else {
      updateFilter(key, undefined);
    }
  };

  return (
    <Collapse in={activeCount > 0} unmountOnExit>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          flexWrap: "wrap",
          px: 2,
          py: 0.75,
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
          backgroundColor: alpha(theme.palette.primary.main, 0.03),
        }}
        role="region"
        aria-label={t("search.activeFilters", "Active filters")}
      >
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, flexShrink: 0 }}>
          {t("search.activeFilters", "Active filters")}:
        </Typography>

        {filterEntries.map(([key, value]) => (
          <Chip
            key={key}
            label={formatFilterLabel(key, value)}
            size="small"
            onDelete={() => handleRemove(key)}
            sx={{
              height: 22,
              fontSize: "0.7rem",
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
              color: "primary.main",
              border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
              "& .MuiChip-deleteIcon": {
                fontSize: 14,
                color: alpha(theme.palette.primary.main, 0.6),
                "&:hover": { color: "primary.main" },
              },
            }}
          />
        ))}

        <Chip
          label={t("search.clearAll", "Clear all")}
          size="small"
          onClick={clearFilters}
          sx={{
            height: 22,
            fontSize: "0.7rem",
            cursor: "pointer",
            color: "text.secondary",
            "&:hover": { backgroundColor: alpha(theme.palette.error.main, 0.08), color: "error.main" },
          }}
        />
      </Box>
    </Collapse>
  );
};

export default ActiveFiltersBar;
