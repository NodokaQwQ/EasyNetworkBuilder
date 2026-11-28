import { alpha, createTheme } from "@mui/material/styles";

import { INPUT_FILL, INPUT_FILL_DARK, LITE_BLUE } from "@/theme/brand";
import { dialogContainerNoFadeSx, dialogPaperVisibility } from "@/theme/dialogCloseMotion";

const GREY = {
  100: "#F9F8FC",
  200: "#F3F2F8",
  300: "#E4E3EE",
  400: "#C5C3D5",
  500: "#8A87A1",
  600: "#4D4B63",
  700: "#323040",
  800: "#1A1924",
  900: "#111118",
};

const ACCENT = LITE_BLUE;
const SURFACE = {
  light: { canvas: "#F9F8FC", paper: "#FFFFFF", low: "#F3F2F8", high: "#E4E3EE", outline: "#C5C3D5" },
  dark: { canvas: "#111118", paper: "#1F1E29", low: "#181821", high: "#282735", outline: "#434059" },
} as const;

const FONT_FAMILY =
  'Inter, "Public Sans Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

const CARD_SHADOW_LIGHT =
  "0 0 2px 0 rgba(145, 158, 171, 0.24), 0 12px 24px -4px rgba(145, 158, 171, 0.16)";
const CARD_SHADOW_DARK =
  "0 0 2px 0 rgba(0, 0, 0, 0.24), 0 12px 24px -4px rgba(0, 0, 0, 0.24)";

export function createAppTheme(mode: "light" | "dark") {
  const isLight = mode === "light";
  const surface = SURFACE[mode];

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isLight ? ACCENT : "#ACA3FF",
        contrastText: isLight ? "#FFFFFF" : "#10066B",
      },
      info: {
        main: isLight ? ACCENT : "#ACA3FF",
        contrastText: isLight ? "#FFFFFF" : "#10066B",
      },
      secondary: {
        main: isLight ? "#554F87" : "#B9B5DE",
      },
      success: {
        main: isLight ? "#0F8B5F" : "#6EE7B7",
      },
      warning: {
        main: isLight ? "#B45309" : "#FCD34D",
      },
      error: {
        main: isLight ? "#BA1A1A" : "#FFB4AB",
      },
      background: {
        default: surface.canvas,
        paper: surface.paper,
      },
      text: {
        primary: isLight ? "#1A1924" : "#E4E3ED",
        secondary: isLight ? "#4D4B63" : "#BAB8CC",
      },
      divider: surface.outline,
      action: {
        hover: surface.high,
        selected: isLight ? "#E0DEF2" : "#3A3663",
      },
    },
    shape: {
      borderRadius: 12,
    },
    typography: {
      fontFamily: FONT_FAMILY,
      h3: { fontWeight: 700, fontSize: 32, lineHeight: 1.25 },
      h4: { fontWeight: 700, fontSize: 24, lineHeight: 1.5 },
      h5: { fontWeight: 700, fontSize: 20, lineHeight: 1.45 },
      h6: { fontWeight: 600, fontSize: 18, lineHeight: 1.4 },
      subtitle1: { fontWeight: 600, fontSize: 16 },
      subtitle2: { fontWeight: 600, fontSize: 14 },
      button: { textTransform: "none", fontWeight: 600, fontSize: 14 },
      caption: { fontSize: 13, fontWeight: 400, lineHeight: 1.45, letterSpacing: 0 },
      overline: {
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: "0.08em",
        lineHeight: 1.5,
      },
      body1: { fontSize: 15, fontWeight: 400, lineHeight: 1.6, letterSpacing: 0 },
      body2: { fontSize: 14, fontWeight: 400, lineHeight: 1.55, letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            WebkitFontSmoothing: "auto",
            MozOsxFontSmoothing: "auto",
            textRendering: "optimizeLegibility",
          },
          body: {
             backgroundColor: surface.canvas,
            WebkitFontSmoothing: "auto",
            MozOsxFontSmoothing: "auto",
            fontSize: 15,
            fontWeight: 400,
            lineHeight: 1.6,
          },
          "[data-admin-shell]": {
            fontSize: 15,
            lineHeight: 1.65,
             color: isLight ? "#1A1924" : "#E4E3ED",
             "--muted-foreground": isLight ? "#4D4B63" : "#BAB8CC",
             "--gray-11": isLight ? "#4D4B63" : "#BAB8CC",
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
             borderRadius: 999,
            fontWeight: 600,
            minWidth: 0,
          },
          sizeSmall: {
            minHeight: 32,
            fontSize: 14,
            paddingLeft: 12,
            paddingRight: 12,
          },
          sizeMedium: {
            minHeight: 38,
            fontSize: 14,
            paddingLeft: 14,
            paddingRight: 14,
          },
          sizeLarge: {
            minHeight: 44,
            fontSize: 14.5,
          },
          contained: {
            "&.MuiButton-colorInherit": {
              backgroundColor: isLight ? GREY[800] : "#FFFFFF",
              color: isLight ? "#FFFFFF" : GREY[800],
              "&:hover": {
                backgroundColor: isLight ? GREY[900] : GREY[100],
              },
            },
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
             borderRadius: 16,
             boxShadow: "none",
             border: `1px solid ${surface.outline}`,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
           rounded: { borderRadius: 16 },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
             borderRadius: 12,
            backgroundColor: isLight ? INPUT_FILL : INPUT_FILL_DARK,
            transition: "border-color 180ms ease, box-shadow 180ms ease",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: alpha(GREY[500], isLight ? 0.2 : 0.32),
              transition: "border-color 180ms ease, border-width 180ms ease",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: alpha(GREY[500], isLight ? 0.4 : 0.48),
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
               borderColor: isLight ? ACCENT : "#ACA3FF",
              borderWidth: 1,
            },
            "&.Mui-focused": {
               boxShadow: `0 0 0 3px ${alpha(isLight ? ACCENT : "#ACA3FF", isLight ? 0.1 : 0.16)}`,
            },
            "&.Mui-disabled": {
              backgroundColor: isLight
                ? alpha(GREY[500], 0.12)
                : alpha(GREY[500], 0.16),
            },
            "&.Mui-disabled .MuiOutlinedInput-notchedOutline": {
              borderColor: alpha(GREY[500], isLight ? 0.16 : 0.2),
            },
          },
          input: {
            padding: "11px 12px",
            fontSize: 14,
            lineHeight: "22px",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            color: isLight ? GREY[800] : "#FFFFFF",
            fontWeight: 400,
            "&::placeholder": {
              color: GREY[500],
              opacity: 1,
            },
            "&:-webkit-autofill, &:-webkit-autofill:hover, &:-webkit-autofill:focus, &:-webkit-autofill:active":
              {
                WebkitTextFillColor: isLight ? GREY[800] : "#FFFFFF",
                caretColor: isLight ? GREY[800] : "#FFFFFF",
                borderRadius: "inherit",
                WebkitBoxShadow: `0 0 0 100px ${isLight ? INPUT_FILL : INPUT_FILL_DARK} inset`,
                transition: "background-color 99999s ease-out 0s",
              },
          },
          sizeSmall: {
            "& .MuiInputBase-input": {
              padding: "9px 12px",
              fontSize: 14,
              lineHeight: "22px",
              height: 40,
              boxSizing: "border-box",
            },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            fontWeight: 400,
            color: isLight ? GREY[600] : GREY[400],
            "&.Mui-focused": { color: ACCENT },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
             borderRadius: 12,
            paddingLeft: 10,
            paddingRight: 10,
            "&.Mui-selected": {
               backgroundColor: isLight ? "#DFDBFF" : "#3A3663",
               color: isLight ? "#10085E" : "#E0DEF2",
              boxShadow: "none",
              "&:hover": {
                 backgroundColor: isLight ? "#E0DEF2" : "#434059",
              },
            },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { color: "inherit", elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: "none",
             backgroundColor: surface.low,
            transition: "none",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
             borderRight: `1px solid ${surface.outline}`,
             backgroundImage: "none",
             backgroundColor: surface.low,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color: isLight ? GREY[600] : GREY[400],
            width: 40,
            height: 40,
            padding: 0,
            borderRadius: "50%",
            "& svg": {
              width: 20,
              height: 20,
              flexShrink: 0,
            },
            "&.MuiIconButton-colorError": {
              color: "#FF5630",
              "&:hover": {
                color: isLight ? "#B71D18" : "#FFAC82",
                backgroundColor: alpha("#FF5630", isLight ? 0.08 : 0.16),
              },
            },
          },
          sizeSmall: {
            width: 28,
            height: 28,
            "& svg": {
              width: 16,
              height: 16,
            },
          },
        },
      },
      MuiMenu: {
        defaultProps: {
          marginThreshold: 8,
          transitionDuration: { enter: 220, exit: 150 },
          slotProps: {
            paper: {
              elevation: 0,
              className: "km-admin-menu",
            },
          },
        },
        styleOverrides: {
          paper: {
             borderRadius: 16,
            padding: 4,
             border: `1px solid ${surface.outline}`,
            backgroundImage: "none",
            boxShadow: isLight ? CARD_SHADOW_LIGHT : CARD_SHADOW_DARK,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            minHeight: 38,
            margin: 0,
            paddingLeft: 10,
            paddingRight: 10,
            transition: "color 150ms ease, background-color 150ms ease",
          },
        },
      },
      MuiDialog: {
        defaultProps: {
          disableScrollLock: true,
          transitionDuration: { enter: 220, exit: 160 },
        },
        styleOverrides: {
          container: {
            ...dialogContainerNoFadeSx,
          },
          paper: ({ ownerState }: { ownerState?: { open?: boolean } }) => ({
             borderRadius: 28,
             border: `1px solid ${surface.outline}`,
            backgroundImage: "none",
            boxShadow: isLight ? CARD_SHADOW_LIGHT : CARD_SHADOW_DARK,
            visibility: dialogPaperVisibility(Boolean(ownerState?.open)),
          }),
        },
      },
      MuiPopover: {
        defaultProps: {
          transitionDuration: { enter: 220, exit: 150 },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { padding: "24px 24px 12px", fontSize: 18, fontWeight: 600 },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            paddingLeft: 24,
            paddingRight: 24,
            paddingTop: 8,
            overflow: "visible",
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: { padding: "16px 24px 24px", gap: 8 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
             borderBottomColor: surface.outline,
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 400,
          },
          head: {
            height: 56,
            color: isLight ? GREY[600] : GREY[400],
             backgroundColor: surface.low,
            fontWeight: 600,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 48,
            textTransform: "none",
            fontSize: 14,
            fontWeight: 500,
            color: isLight ? GREY[600] : GREY[400],
            "&.Mui-selected": { color: isLight ? GREY[800] : "#FFFFFF", fontWeight: 600 },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
           root: { borderRadius: 999, fontWeight: 600 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
             borderRadius: 16,
            fontSize: 14,
            fontWeight: 400,
            alignItems: "flex-start",
            "&.MuiAlert-standardWarning": {
              color: isLight ? "#7A4100" : "#FFD8A8",
              backgroundColor: isLight ? "#FFF5E6" : alpha("#FFAB00", 0.12),
            },
          },
          icon: {
            display: "flex",
            alignItems: "center",
            marginRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 0,
            paddingRight: 0,
            "& svg": {
              display: "block",
              fontSize: 22,
            },
          },
          message: {
            paddingTop: 8,
            paddingBottom: 8,
            lineHeight: 1.5,
          },
        },
      },
      MuiAlertTitle: {
        styleOverrides: {
          root: {
            marginTop: 0,
            marginBottom: 4,
            lineHeight: 1.5,
          },
        },
      },
      MuiAccordionSummary: {
        styleOverrides: {
          root: {
            minHeight: 48,
            alignItems: "center",
          },
          content: {
            margin: "12px 0",
            alignItems: "center",
          },
          expandIconWrapper: {
            display: "inline-flex",
            alignItems: "center",
            alignSelf: "center",
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
      },
      MuiCheckbox: {
        defaultProps: { color: "primary" },
        styleOverrides: {
          root: {
            color: GREY[500],
            "&.Mui-checked, &.MuiCheckbox-indeterminate": {
              color: ACCENT,
            },
          },
        },
      },
      MuiSwitch: {
        defaultProps: { color: "primary" },
        styleOverrides: {
          root: {
            width: 38,
            height: 22,
            padding: 0,
            overflow: "visible",
          },
          switchBase: {
            padding: 3,
            transitionDuration: "180ms",
            "&.Mui-checked": {
              transform: "translateX(16px)",
              color: "#FFFFFF",
              "+ .MuiSwitch-track": {
                backgroundColor: ACCENT,
                opacity: 1,
              },
            },
          },
          thumb: {
            width: 16,
            height: 16,
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.24)",
          },
          track: {
            borderRadius: 11,
            backgroundColor: isLight ? GREY[400] : GREY[600],
            opacity: 1,
            transition: "background-color 180ms ease",
          },
        },
      },
      MuiRadio: {
        defaultProps: { color: "primary" },
      },
      MuiSelect: {
        styleOverrides: {
          select: {
            display: "flex",
            alignItems: "center",
            minHeight: 40,
            boxSizing: "border-box",
          },
          icon: {
            transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
          },
        },
      },
      MuiAutocomplete: {
        defaultProps: {
          openOnFocus: true,
          clearOnEscape: true,
        },
        styleOverrides: {
          root: {
            "& .MuiAutocomplete-popupIndicator, & .MuiAutocomplete-clearIndicator": {
              width: 24,
              height: 24,
              padding: 0,
              borderRadius: 6,
              transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
            },
            "& .MuiAutocomplete-popupIndicatorOpen": {
              transform: "rotate(180deg)",
            },
          },
          paper: {
            marginTop: 4,
            padding: 4,
            borderRadius: 8,
            border: `1px solid ${alpha(GREY[500], isLight ? 0.2 : 0.24)}`,
            backgroundImage: "none",
            boxShadow: isLight ? CARD_SHADOW_LIGHT : CARD_SHADOW_DARK,
          },
          listbox: {
            padding: 0,
            maxHeight: 280,
            "& .MuiAutocomplete-option": {
              minHeight: 38,
              margin: 0,
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: 14,
              transition: "color 150ms ease, background-color 150ms ease",
            },
          },
        },
      },
    },
  });
}
