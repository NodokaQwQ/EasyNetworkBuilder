/**
 * EasyNetworkBuilder — Material Design 3 (Material You) Design System Tokens
 * Seed Color: #5845FF
 * Reference: easynetworkbuilder_material_design_you.html
 */

export type Md3Mode = "light" | "dark";

export const MD3_FONT_SANS =
  '"Inter Variable", "Inter", "Public Sans Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

export const MD3_FONT_MONO =
  '"JetBrains Mono Variable", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

export const MD3_SHAPE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 28,
  full: 9999,
} as const;

export const MD3_ELEVATION = {
  0: "none",
  1: "0 1px 2px rgba(0,0,0,0.14), 0 1px 3px 1px rgba(0,0,0,0.08)",
  2: "0 1px 2px rgba(0,0,0,0.16), 0 2px 6px 2px rgba(0,0,0,0.10)",
  3: "0 4px 8px 3px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.18)",
  4: "0 6px 10px 4px rgba(0,0,0,0.12), 0 2px 3px rgba(0,0,0,0.20)",
  5: "0 8px 12px 6px rgba(0,0,0,0.14), 0 4px 4px rgba(0,0,0,0.22)",
} as const;

export const MD3_MOTION = {
  easingEmphasized: "cubic-bezier(0.2, 0, 0, 1)",
  easingStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easingDecelerate: "cubic-bezier(0, 0, 0, 1)",
  easingAccelerate: "cubic-bezier(0.3, 0, 1, 1)",
  durationShort: "150ms",
  durationMedium: "250ms",
  durationLong: "500ms",
} as const;

export const MD3_COLORS = {
  light: {
    primary: "#5845FF",
    onPrimary: "#FFFFFF",
    primaryContainer: "#DFDBFF",
    onPrimaryContainer: "#10085E",

    secondary: "#554F87",
    onSecondary: "#FFFFFF",
    secondaryContainer: "#E0DEF2",
    onSecondaryContainer: "#1D1B37",

    tertiary: "#D946EF",
    onTertiary: "#FFFFFF",
    tertiaryContainer: "#FAE8FF",
    onTertiaryContainer: "#701A75",

    surface: "#F9F8FC",
    surfaceContainerLowest: "#FFFFFF",
    surfaceContainerLow: "#F3F2F8",
    surfaceContainer: "#EDECF4",
    surfaceContainerHigh: "#E4E3EE",
    surfaceContainerHighest: "#DCDAE7",

    onSurface: "#1A1924",
    onSurfaceVariant: "#4D4B63",
    outline: "#73708F",
    outlineVariant: "#C5C3D5",

    error: "#F43F5E",
    onError: "#FFFFFF",
    errorContainer: "#FFE4E6",
    onErrorContainer: "#881337",

    inverseSurface: "#2F2E3B",
    inverseOnSurface: "#F2F0F7",
    inversePrimary: "#ACA3FF",

    opsHealthy: "#10B981",
    opsHealthyContainer: "#D1FAE5",
    opsOnHealthyContainer: "#065F46",
    opsWarning: "#F59E0B",
    opsWarningContainer: "#FEF3C7",
    opsOnWarningContainer: "#92400E",
  },
  dark: {
    primary: "#ACA3FF",
    onPrimary: "#10066B",
    primaryContainer: "#1D0EAA",
    onPrimaryContainer: "#DFDBFF",

    secondary: "#B9B5DE",
    onSecondary: "#252145",
    secondaryContainer: "#3A3663",
    onSecondaryContainer: "#E0DEF2",

    tertiary: "#F2A6DE",
    onTertiary: "#541242",
    tertiaryContainer: "#7C2765",
    onTertiaryContainer: "#FCD9F3",

    surface: "#111118",
    surfaceContainerLowest: "#0B0A0F",
    surfaceContainerLow: "#181821",
    surfaceContainer: "#1F1E29",
    surfaceContainerHigh: "#282735",
    surfaceContainerHighest: "#323040",

    onSurface: "#E4E3ED",
    onSurfaceVariant: "#BAB8CC",
    outline: "#8A87A1",
    outlineVariant: "#434059",

    error: "#FFB4AB",
    onError: "#690005",
    errorContainer: "#93000A",
    onErrorContainer: "#FFDAD6",

    inverseSurface: "#E4E3ED",
    inverseOnSurface: "#2F2E3B",
    inversePrimary: "#5845FF",

    opsHealthy: "#6EE7B7",
    opsHealthyContainer: "#064E3B",
    opsOnHealthyContainer: "#D1FAE5",
    opsWarning: "#FCD34D",
    opsWarningContainer: "#78350F",
    opsOnWarningContainer: "#FEF3C7",
  },
} as const;
