import type { Theme } from "@mui/material/styles";

import { ADMIN_MENU_FONT_SIZE } from "@/components/admin/adminMenu";
import { INPUT_FILL_DARK, NEBURST_NEUTRAL } from "@/theme/brand";

export const FILTER_BAR = NEBURST_NEUTRAL;
export const FILTER_FIELD = "#FFFFFF";

const fieldFill = (theme: Theme) =>
  theme.palette.mode === "dark" ? INPUT_FILL_DARK : FILTER_FIELD;

export const ADMIN_LIST_FILTERS_BAR_SX = {
  bgcolor: (theme: Theme) =>
    theme.palette.mode === "dark" ? theme.palette.background.default : FILTER_BAR,
};

export const ADMIN_FILTER_MENU_ITEM_SX = {
  gap: 1,
  borderRadius: 0,
  "&.Mui-selected": {
    bgcolor: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
  },
  "&.Mui-selected:hover": {
    bgcolor: "var(--md-sys-color-secondary-container)",
  },
};

export const ADMIN_LIST_FIELD_SX = {
  flex: { xs: "1 1 calc(50% - 12px)", md: "0 1 auto" },
  minWidth: { xs: 0, md: 132 },
  bgcolor: "transparent",
  "& .MuiInputLabel-root": {
    color: "text.secondary",
    fontSize: ADMIN_MENU_FONT_SIZE,
    fontWeight: 500,
    transform: "translate(14px, 9px) scale(1)",
    transition:
      "color 150ms cubic-bezier(0.2, 0, 0, 1), transform 250ms cubic-bezier(0.2, 0, 0, 1)",
  },
  "& .MuiInputLabel-root.MuiInputLabel-shrink": {
    transform: "translate(14px, -8px) scale(0.75)",
  },
  "& .MuiInputLabel-root.Mui-focused": {
    color: "primary.main",
  },
  "&.km-admin-filter-control:not(.is-open) .MuiInputLabel-root.Mui-focused": {
    color: "text.secondary",
  },
  "&.km-admin-filter-control.is-open .MuiInputLabel-root": {
    color: "primary.main",
  },
  "& .MuiOutlinedInput-root": {
    bgcolor: fieldFill,
    borderRadius: "12px",
    fontSize: ADMIN_MENU_FONT_SIZE,
    minHeight: 40,
    height: 40,
    transition:
      "background-color 150ms cubic-bezier(0.2, 0, 0, 1), box-shadow 150ms cubic-bezier(0.2, 0, 0, 1)",
    "& fieldset": {
      borderRadius: "12px",
      transition: "border-color 150ms ease, border-width 150ms ease",
    },
    "& legend": {
      transition: "max-width 250ms cubic-bezier(0.2, 0, 0, 1)",
    },
    "&.Mui-focused fieldset": {
      borderColor: "var(--md-sys-color-primary) !important",
    },
  },
  "&.km-admin-filter-control:not(.is-open) .km-admin-filter-select.Mui-focused fieldset": {
    borderColor: "var(--gray-a5) !important",
    borderWidth: "1px",
  },
  "&.km-admin-filter-control:not(.is-open) .km-admin-filter-select.Mui-focused": {
    boxShadow: "none",
  },
  "&.km-admin-filter-control:not(.is-open) .km-admin-filter-select:focus-visible fieldset": {
    borderColor: "var(--md-sys-color-primary) !important",
    borderWidth: "2px",
  },
  "&.km-admin-filter-control.is-open .km-admin-filter-select fieldset": {
    borderColor: "var(--md-sys-color-primary) !important",
    borderWidth: "2px",
  },
  "& .MuiSelect-select": {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    overflow: "hidden",
    py: 0,
    height: 40,
    boxSizing: "border-box",
    fontSize: ADMIN_MENU_FONT_SIZE,
    fontWeight: 500,
    lineHeight: "22px",
  },
  "& .MuiSelect-icon": {
    transition: "transform 250ms cubic-bezier(0.2, 0, 0, 1)",
  },
  "& .MuiSelect-iconOpen": {
    transform: "rotate(180deg)",
  },
};

export const ADMIN_LIST_SEARCH_SX = {
  flex: { xs: "1 1 100%", md: "1 1 160px" },
  minWidth: { xs: "100%", md: 160 },
  bgcolor: "transparent",
  "& .MuiOutlinedInput-root": {
    borderRadius: "9999px",
    bgcolor: (theme: Theme) => `${fieldFill(theme)} !important`,
    fontSize: ADMIN_MENU_FONT_SIZE,
    minHeight: 40,
    height: 40,
    px: 0.5,
    transition:
      "background-color 150ms cubic-bezier(0.2, 0, 0, 1), box-shadow 150ms cubic-bezier(0.2, 0, 0, 1)",
    "& fieldset": {
      borderRadius: "9999px",
      transition: "border-color 150ms ease, border-width 150ms ease",
    },
    "&.Mui-focused fieldset": {
      borderColor: "var(--md-sys-color-primary) !important",
    },
    "& .MuiInputAdornment-root": {
      color: "text.secondary",
      transition: "color 150ms ease",
    },
    "&.Mui-focused .MuiInputAdornment-root": { color: "primary.main" },
  },
  "& .MuiInputBase-input": {
    fontSize: ADMIN_MENU_FONT_SIZE,
    fontWeight: 500,
    lineHeight: "22px",
    height: 40,
    py: 0,
    display: "flex",
    alignItems: "center",
  },
};

export const ADMIN_LIST_ACTION_SX = {
  textTransform: "none" as const,
  fontWeight: 600,
  fontSize: 14,
  height: 40,
  minHeight: 40,
  px: 2.25,
  borderRadius: "9999px",
  boxShadow: "none",
  "&:hover": { boxShadow: "none" },
  "& .MuiButton-startIcon": { mr: 0.75, ml: 0 },
};

export const ADMIN_LIST_OUTLINE_SX = {
  ...ADMIN_LIST_ACTION_SX,
  bgcolor: "transparent",
  borderColor: "var(--md-sys-color-outline)",
  color: "text.primary",
  "&:hover": {
    boxShadow: "none",
    bgcolor: "color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent)",
    borderColor: "var(--md-sys-color-primary)",
  },
};
