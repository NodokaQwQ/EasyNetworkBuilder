import { getAppAssetUrl } from "@/utils/assetUrl";

const metricCardBackgroundLight = getAppAssetUrl(
  "assets/lite-card-background-v4-light.svg?v=20260825-3",
);
const metricCardBackgroundDark = getAppAssetUrl(
  "assets/lite-card-background-v4-dark.svg?v=20260825-3",
);

export const metricCardSurfaceSx = {
  backgroundColor: "#F3F2F8",
  "html.dark &": {
    backgroundColor: "#282735",
  },
} as const;

export const metricCardSx = {
  "--metric-label-color": "#4D4B63",
  "--metric-value-color": "#1A1924",
  "--metric-empty-color": "#73708F",
  overflow: "hidden",
  ...metricCardSurfaceSx,
  backgroundImage: `url("${metricCardBackgroundLight}")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right center",
  backgroundSize: "auto 100%",
  "html.dark &": {
    ...metricCardSurfaceSx["html.dark &"],
    "--metric-label-color": "#BAB8CC",
    "--metric-value-color": "#E4E3ED",
    "--metric-empty-color": "#8A87A1",
    backgroundImage: `url("${metricCardBackgroundDark}")`,
  },
} as const;

export const usageMetricCardSx = {
  ...metricCardSx,
  backgroundColor: "#FFFFFF",
  "html.dark &": {
    ...metricCardSx["html.dark &"],
    backgroundColor: "#1F1E29",
  },
} as const;
