import type { MenuProps } from "@mui/material/Menu";

export const ADMIN_MENU_FONT_SIZE = 14;

export function getAdminMenuProps(minWidth?: number): Partial<MenuProps> {
  return {
    disableRestoreFocus: true,
    marginThreshold: 8,
    transitionDuration: { enter: 220, exit: 150 },
    anchorOrigin: { vertical: "bottom", horizontal: "left" },
    transformOrigin: { vertical: "top", horizontal: "left" },
    slotProps: {
      transition: {
        easing: {
          enter: "cubic-bezier(0.2, 0, 0, 1)",
          exit: "cubic-bezier(0.3, 0, 1, 1)",
        },
      },
      paper: {
        className: "km-admin-menu",
        sx: {
          mt: "6px",
          ml: 0,
          minWidth,
          p: "6px 0",
          overflowX: "hidden",
          overflowY: "auto",
          maxHeight: "min(320px, calc(100dvh - 16px))",
          borderRadius: "var(--md-sys-shape-xs)",
          border: "1px solid var(--md-sys-color-outline-variant)",
          bgcolor: "var(--md-sys-color-surface-container)",
          backgroundImage: "none",
          willChange: "opacity, transform",
          boxShadow: "var(--md-sys-elevation-2)",
        },
      },
      list: {
        dense: true,
        sx: {
          p: 0,
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          "& .MuiMenuItem-root": {
            minHeight: 38,
            m: 0,
            px: 1.75,
            py: 0.75,
            borderRadius: 0,
            fontSize: ADMIN_MENU_FONT_SIZE,
            fontWeight: 500,
            lineHeight: 1.25,
            boxShadow: "none",
            transition: "color 150ms ease, background-color 150ms ease",
          },
        },
      },
    },
  };
}

export const adminMenuProps = getAdminMenuProps();
