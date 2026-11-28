import { alpha, createTheme } from "@mui/material/styles";

import { INPUT_FILL, INPUT_FILL_DARK, LITE_BLUE } from "@/theme/brand";
import { dialogContainerNoFadeSx, dialogPaperVisibility } from "@/theme/dialogCloseMotion";
import {
  MD3_COLORS,
  MD3_ELEVATION,
  MD3_FONT_SANS,
  MD3_MOTION,
  MD3_SHAPE,
} from "@/theme/md3Tokens";

const ACCENT = LITE_BLUE;

export function createAppTheme(mode: "light" | "dark") {
  const isLight = mode === "light";
  const tokens = MD3_COLORS[mode];

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isLight ? ACCENT : "#ACA3FF",
        contrastText: tokens.onPrimary,
      },
      info: {
        main: isLight ? ACCENT : "#ACA3FF",
        contrastText: tokens.onPrimary,
      },
      secondary: {
        main: tokens.secondary,
        contrastText: tokens.onSecondary,
      },
      success: {
        main: tokens.opsHealthy,
        contrastText: isLight ? "#FFFFFF" : "#022C22",
      },
      warning: {
        main: tokens.opsWarning,
        contrastText: isLight ? "#FFFFFF" : "#451A03",
      },
      error: {
        main: tokens.error,
        contrastText: tokens.onError,
      },
      background: {
        default: tokens.surface,
        paper: isLight ? tokens.surfaceContainerLowest : tokens.surfaceContainer,
      },
      text: {
        primary: tokens.onSurface,
        secondary: tokens.onSurfaceVariant,
      },
      divider: tokens.outlineVariant,
      action: {
        hover: alpha(tokens.onSurface, 0.08),
        selected: tokens.secondaryContainer,
        focus: alpha(tokens.onSurface, 0.1),
        disabledOpacity: 0.38,
      },
    },
    shape: {
      borderRadius: MD3_SHAPE.md,
    },
    typography: {
      fontFamily: MD3_FONT_SANS,
      h3: { fontWeight: 700, fontSize: 32, lineHeight: 1.25, letterSpacing: "-0.02em" },
      h4: { fontWeight: 700, fontSize: 24, lineHeight: 1.45, letterSpacing: "-0.015em" },
      h5: { fontWeight: 700, fontSize: 20, lineHeight: 1.4, letterSpacing: "-0.01em" },
      h6: { fontWeight: 600, fontSize: 18, lineHeight: 1.4 },
      subtitle1: { fontWeight: 600, fontSize: 16 },
      subtitle2: { fontWeight: 600, fontSize: 14 },
      button: { textTransform: "none", fontWeight: 600, fontSize: 14 },
      caption: { fontSize: 13, fontWeight: 400, lineHeight: 1.45, letterSpacing: 0 },
      overline: {
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: "0.06em",
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
            backgroundColor: tokens.surface,
            color: tokens.onSurface,
            WebkitFontSmoothing: "auto",
            MozOsxFontSmoothing: "auto",
            fontSize: 15,
            fontWeight: 400,
            lineHeight: 1.55,
          },
          "[data-admin-shell]": {
            fontSize: 15,
            lineHeight: 1.6,
            color: tokens.onSurface,
            "--muted-foreground": tokens.onSurfaceVariant,
            "--gray-11": tokens.onSurfaceVariant,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: MD3_SHAPE.full,
            fontWeight: 600,
            minWidth: 0,
            transition: `transform 120ms ${MD3_MOTION.easingStandard}, background-color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}, border-color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}, box-shadow ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}, opacity ${MD3_MOTION.durationShort} ease`,
            "&:active": {
              transform: "scale(0.97)",
            },
            "&.Mui-disabled": {
              opacity: 0.38,
              boxShadow: "none",
              transform: "none",
            },
          },
          sizeSmall: {
            minHeight: 32,
            fontSize: 13,
            paddingLeft: 14,
            paddingRight: 14,
          },
          sizeMedium: {
            minHeight: 38,
            fontSize: 14,
            paddingLeft: 18,
            paddingRight: 18,
          },
          sizeLarge: {
            minHeight: 44,
            fontSize: 14.5,
            paddingLeft: 22,
            paddingRight: 22,
          },
          contained: {
            "&.MuiButton-colorInherit": {
              backgroundColor: tokens.secondaryContainer,
              color: tokens.onSecondaryContainer,
              "&:hover": {
                backgroundColor: isLight
                  ? alpha(tokens.onSecondaryContainer, 0.12)
                  : alpha(tokens.onSecondaryContainer, 0.16),
                backgroundImage: `linear-gradient(${tokens.secondaryContainer}, ${tokens.secondaryContainer})`,
              },
            },
          },
          outlined: {
            borderColor: tokens.outline,
            "&:hover": {
              borderColor: tokens.primary,
              backgroundColor: alpha(tokens.primary, 0.08),
            },
            "&.MuiButton-colorInherit": {
              borderColor: tokens.outlineVariant,
              color: tokens.onSurface,
              "&:hover": {
                borderColor: tokens.outline,
                backgroundColor: alpha(tokens.onSurface, 0.08),
              },
            },
          },
          text: {
            "&:hover": {
              backgroundColor: alpha(tokens.primary, 0.08),
            },
            "&.MuiButton-colorInherit:hover": {
              backgroundColor: alpha(tokens.onSurface, 0.08),
            },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            borderRadius: MD3_SHAPE.full,
            border: `1px solid ${tokens.outline}`,
            overflow: "hidden",
            backgroundColor: "transparent",
          },
          grouped: {
            margin: 0,
            border: 0,
            borderRadius: 0,
            "&:not(:last-of-type)": {
              borderRight: `1px solid ${tokens.outline}`,
            },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
            fontSize: 13,
            color: tokens.onSurfaceVariant,
            padding: "6px 14px",
            transition: `background-color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}, color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}`,
            "&:hover": {
              backgroundColor: alpha(tokens.onSurface, 0.08),
            },
            "&.Mui-selected": {
              backgroundColor: tokens.secondaryContainer,
              color: tokens.onSecondaryContainer,
              "&:hover": {
                backgroundColor: tokens.secondaryContainer,
              },
            },
          },
        },
      },
      MuiFab: {
        styleOverrides: {
          root: {
            borderRadius: MD3_SHAPE.lg,
            backgroundColor: tokens.primaryContainer,
            color: tokens.onPrimaryContainer,
            boxShadow: MD3_ELEVATION[3],
            textTransform: "none",
            fontWeight: 600,
            "&:hover": {
              backgroundColor: tokens.primaryContainer,
              boxShadow: MD3_ELEVATION[4],
            },
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderRadius: MD3_SHAPE.lg,
            boxShadow: "none",
            border: `1px solid ${tokens.outlineVariant}`,
            backgroundImage: "none",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
          rounded: { borderRadius: MD3_SHAPE.lg },
          outlined: {
            borderColor: tokens.outlineVariant,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: MD3_SHAPE.md,
            backgroundColor: isLight ? INPUT_FILL : INPUT_FILL_DARK,
            transition: `border-color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}, box-shadow ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}`,
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: tokens.outlineVariant,
              transition: `border-color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}, border-width ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}`,
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: tokens.outline,
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: tokens.primary,
              borderWidth: 1.5,
            },
            "&.Mui-focused": {
              boxShadow: `0 0 0 2px ${alpha(tokens.primary, 0.22)}`,
            },
            "&.Mui-error .MuiOutlinedInput-notchedOutline": {
              borderColor: tokens.error,
            },
            "&.Mui-error.Mui-focused": {
              boxShadow: `0 0 0 2px ${alpha(tokens.error, 0.2)}`,
            },
            "&.Mui-disabled": {
              backgroundColor: alpha(tokens.onSurface, isLight ? 0.04 : 0.06),
            },
            "&.Mui-disabled .MuiOutlinedInput-notchedOutline": {
              borderColor: alpha(tokens.onSurface, 0.12),
            },
          },
          input: {
            padding: "11px 12px",
            fontSize: 14,
            lineHeight: "22px",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            color: tokens.onSurface,
            fontWeight: 400,
            "&::placeholder": {
              color: tokens.outline,
              opacity: 1,
            },
            "&:-webkit-autofill, &:-webkit-autofill:hover, &:-webkit-autofill:focus, &:-webkit-autofill:active":
              {
                WebkitTextFillColor: tokens.onSurface,
                caretColor: tokens.onSurface,
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
            fontWeight: 500,
            color: tokens.onSurfaceVariant,
            "&.Mui-focused": { color: tokens.primary },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: MD3_SHAPE.full,
            paddingLeft: 14,
            paddingRight: 14,
            transition: `background-color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}, color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}`,
            "&:hover": {
              backgroundColor: alpha(tokens.onSurface, 0.08),
            },
            "&.Mui-selected": {
              backgroundColor: tokens.secondaryContainer,
              color: tokens.onSecondaryContainer,
              boxShadow: "none",
              "&:hover": {
                backgroundColor: isLight
                  ? "#D6D3EC"
                  : "#454073",
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
            backgroundColor: tokens.surfaceContainerLow,
            transition: "none",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            borderRight: `1px solid ${tokens.outlineVariant}`,
            backgroundImage: "none",
            backgroundColor: tokens.surfaceContainerLow,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color: tokens.onSurfaceVariant,
            width: 40,
            height: 40,
            padding: 0,
            borderRadius: "50%",
            transition: `transform 120ms ${MD3_MOTION.easingStandard}, background-color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}, color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}`,
            "&:hover": {
              backgroundColor: alpha(tokens.onSurface, 0.08),
            },
            "&:active": {
              transform: "scale(0.95)",
            },
            "& svg": {
              width: 20,
              height: 20,
              flexShrink: 0,
            },
            "&.MuiIconButton-colorError": {
              color: tokens.error,
              "&:hover": {
                color: tokens.onErrorContainer,
                backgroundColor: tokens.errorContainer,
              },
            },
          },
          sizeSmall: {
            width: 30,
            height: 30,
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
            borderRadius: MD3_SHAPE.xs,
            padding: "6px 0",
            border: `1px solid ${tokens.outlineVariant}`,
            backgroundColor: tokens.surfaceContainer,
            backgroundImage: "none",
            boxShadow: MD3_ELEVATION[2],
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            minHeight: 38,
            margin: 0,
            paddingLeft: 14,
            paddingRight: 14,
            transition: `color ${MD3_MOTION.durationShort} ease, background-color ${MD3_MOTION.durationShort} ease`,
            "&:hover": {
              backgroundColor: alpha(tokens.onSurface, 0.08),
            },
            "&.Mui-selected": {
              backgroundColor: tokens.secondaryContainer,
              color: tokens.onSecondaryContainer,
              fontWeight: 600,
              "&:hover": {
                backgroundColor: isLight ? "#D6D3EC" : "#454073",
              },
            },
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
          backdrop: {
            backgroundColor: "rgba(11, 10, 15, 0.52)",
          },
          paper: ({ ownerState }: { ownerState?: { open?: boolean } }) => ({
            borderRadius: MD3_SHAPE.xl,
            border: `1px solid ${tokens.outlineVariant}`,
            backgroundColor: tokens.surfaceContainerHigh,
            backgroundImage: "none",
            boxShadow: MD3_ELEVATION[3],
            visibility: dialogPaperVisibility(Boolean(ownerState?.open)),
          }),
        },
      },
      MuiPopover: {
        defaultProps: {
          transitionDuration: { enter: 220, exit: 150 },
        },
        styleOverrides: {
          paper: {
            borderRadius: MD3_SHAPE.md,
            border: `1px solid ${tokens.outlineVariant}`,
            backgroundColor: isLight ? tokens.surfaceContainerLowest : tokens.surfaceContainerHigh,
            backgroundImage: "none",
            boxShadow: MD3_ELEVATION[2],
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { padding: "24px 24px 12px", fontSize: 18, fontWeight: 700 },
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
            borderBottomColor: tokens.outlineVariant,
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 400,
          },
          head: {
            height: 52,
            color: tokens.onSurfaceVariant,
            backgroundColor: tokens.surfaceContainerLow,
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
            color: tokens.onSurfaceVariant,
            transition: `color ${MD3_MOTION.durationShort} ${MD3_MOTION.easingStandard}`,
            "&.Mui-selected": { color: tokens.primary, fontWeight: 600 },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            height: 3,
            borderRadius: "3px 3px 0 0",
            backgroundColor: tokens.primary,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: MD3_SHAPE.full,
            fontWeight: 600,
            transition: `background-color ${MD3_MOTION.durationShort} ease, border-color ${MD3_MOTION.durationShort} ease`,
          },
          outlined: {
            borderColor: tokens.outlineVariant,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: MD3_SHAPE.lg,
            fontSize: 14,
            fontWeight: 400,
            alignItems: "flex-start",
            border: `1px solid ${tokens.outlineVariant}`,
            "&.MuiAlert-standardInfo": {
              backgroundColor: isLight
                ? alpha(tokens.primaryContainer, 0.65)
                : alpha(tokens.primaryContainer, 0.42),
              color: tokens.onPrimaryContainer,
              borderColor: alpha(tokens.primary, 0.24),
              "& .MuiAlert-icon": { color: tokens.primary },
            },
            "&.MuiAlert-standardSuccess": {
              backgroundColor: tokens.opsHealthyContainer,
              color: tokens.opsOnHealthyContainer,
              borderColor: alpha(tokens.opsHealthy, 0.28),
              "& .MuiAlert-icon": { color: tokens.opsHealthy },
            },
            "&.MuiAlert-standardWarning": {
              backgroundColor: tokens.opsWarningContainer,
              color: tokens.opsOnWarningContainer,
              borderColor: alpha(tokens.opsWarning, 0.28),
              "& .MuiAlert-icon": { color: tokens.opsWarning },
            },
            "&.MuiAlert-standardError": {
              backgroundColor: tokens.errorContainer,
              color: tokens.onErrorContainer,
              borderColor: alpha(tokens.error, 0.28),
              "& .MuiAlert-icon": { color: tokens.error },
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
            fontWeight: 700,
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
        defaultProps: { arrow: false },
        styleOverrides: {
          tooltip: {
            backgroundColor: tokens.inverseSurface,
            color: tokens.inverseOnSurface,
            borderRadius: MD3_SHAPE.xs,
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1.4,
          },
          arrow: {
            color: tokens.inverseSurface,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            height: 6,
            borderRadius: MD3_SHAPE.full,
            backgroundColor: tokens.primaryContainer,
            overflow: "hidden",
          },
          bar: {
            borderRadius: MD3_SHAPE.full,
            backgroundColor: tokens.primary,
          },
        },
      },
      MuiCheckbox: {
        defaultProps: { color: "primary" },
        styleOverrides: {
          root: {
            color: tokens.outline,
            borderRadius: MD3_SHAPE.sm,
            "&.Mui-checked, &.MuiCheckbox-indeterminate": {
              color: tokens.primary,
            },
          },
        },
      },
      MuiSwitch: {
        defaultProps: { color: "primary" },
        styleOverrides: {
          root: {
            width: 48,
            height: 28,
            padding: 0,
            overflow: "visible",
          },
          switchBase: {
            padding: 0,
            top: "50%",
            left: 6,
            transform: "translateY(-50%)",
            transition: `left 200ms ${MD3_MOTION.easingEmphasized}, transform 200ms ${MD3_MOTION.easingEmphasized}, color 200ms ease`,
            "&.Mui-checked": {
              left: 24,
              transform: "translateY(-50%)",
              color: tokens.onPrimary,
              "& .MuiSwitch-thumb": {
                width: 20,
                height: 20,
                backgroundColor: tokens.onPrimary,
              },
              "+ .MuiSwitch-track": {
                backgroundColor: tokens.primary,
                borderColor: tokens.primary,
                opacity: 1,
              },
            },
            "&.Mui-disabled": {
              opacity: 0.38,
              "+ .MuiSwitch-track": {
                opacity: 0.38,
              },
            },
          },
          thumb: {
            width: 14,
            height: 14,
            borderRadius: "50%",
            backgroundColor: tokens.outline,
            boxShadow: "none",
            transition: `width 200ms ${MD3_MOTION.easingEmphasized}, height 200ms ${MD3_MOTION.easingEmphasized}, background-color 200ms ease`,
          },
          track: {
            borderRadius: MD3_SHAPE.full,
            boxSizing: "border-box",
            backgroundColor: tokens.surfaceContainerHighest,
            border: `2px solid ${tokens.outline}`,
            opacity: 1,
            transition: `background-color 200ms ${MD3_MOTION.easingEmphasized}, border-color 200ms ${MD3_MOTION.easingEmphasized}`,
          },
        },
      },
      MuiRadio: {
        defaultProps: { color: "primary" },
        styleOverrides: {
          root: {
            color: tokens.outline,
            "&.Mui-checked": {
              color: tokens.primary,
            },
          },
        },
      },
      MuiSlider: {
        styleOverrides: {
          root: {
            color: tokens.primary,
            height: 6,
          },
          rail: {
            backgroundColor: tokens.primaryContainer,
            opacity: 1,
            borderRadius: MD3_SHAPE.full,
          },
          track: {
            border: "none",
            borderRadius: MD3_SHAPE.full,
          },
          thumb: {
            width: 18,
            height: 18,
            backgroundColor: tokens.primary,
            "&:hover, &.Mui-focusVisible": {
              boxShadow: `0 0 0 8px ${alpha(tokens.primary, 0.16)}`,
            },
          },
        },
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
            color: tokens.onSurfaceVariant,
            transition: `transform ${MD3_MOTION.durationMedium} ${MD3_MOTION.easingEmphasized}`,
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
              borderRadius: "50%",
              color: tokens.onSurfaceVariant,
              transition: `transform ${MD3_MOTION.durationMedium} ${MD3_MOTION.easingEmphasized}`,
            },
            "& .MuiAutocomplete-popupIndicatorOpen": {
              transform: "rotate(180deg)",
            },
          },
          paper: {
            marginTop: 6,
            padding: "6px 0",
            borderRadius: MD3_SHAPE.xs,
            border: `1px solid ${tokens.outlineVariant}`,
            backgroundColor: tokens.surfaceContainer,
            backgroundImage: "none",
            boxShadow: MD3_ELEVATION[2],
          },
          listbox: {
            padding: 0,
            maxHeight: 280,
            "& .MuiAutocomplete-option": {
              minHeight: 38,
              margin: 0,
              padding: "9px 14px",
              borderRadius: 0,
              fontSize: 14,
              transition: `color ${MD3_MOTION.durationShort} ease, background-color ${MD3_MOTION.durationShort} ease`,
              "&[aria-selected='true']": {
                backgroundColor: tokens.secondaryContainer,
                color: tokens.onSecondaryContainer,
                fontWeight: 600,
              },
            },
          },
        },
      },
    },
  });
}
