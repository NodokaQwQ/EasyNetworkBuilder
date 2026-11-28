/** Ordered categorical colors from the ENB Material You chart specification. */
export const CHART_PALETTE_LIGHT = [
  "#5845FF", "#EC4899", "#06B6D4", "#10B981", "#8B5CF6", "#3B82F6",
  "#D946EF", "#F43F5E", "#14B8A6", "#6366F1", "#0EA5E9", "#A855F7",
  "#FB7185", "#22D3EE", "#34D399", "#7C3AED", "#F472B6", "#60A5FA",
  "#C026D3", "#2DD4BF", "#818CF8", "#38BDF8", "#E879F9", "#4ADE80",
] as const;

export const CHART_PALETTE_DARK = [
  "#9D92FF", "#FF9ED2", "#6EE7F5", "#73F2BE", "#C4B5FD", "#8EC5FF",
  "#F5A6FF", "#FF9CB0", "#6EF0DC", "#A5B4FC", "#7AD7FF", "#D8B4FE",
  "#FECDD3", "#A5F3FC", "#A7F3D0", "#B59CFF", "#FBCFE8", "#BFDBFE",
  "#E89BFF", "#99F6E4", "#C7D2FE", "#BAE6FD", "#F5D0FE", "#BBF7D0",
] as const;

/** Zero-based stable series order, shared by marks, legends and tooltip rows. */
export function chartSeriesColor(index: number) {
  const slot = Number.isFinite(index) ? ((Math.trunc(index) % 24) + 24) % 24 : 0;
  return `var(--chart-series-${slot + 1}, ${CHART_PALETTE_LIGHT[slot]})`;
}

export const CHART_COLORS = {
  inbound: chartSeriesColor(0),
  outbound: chartSeriesColor(1),
  cpu: chartSeriesColor(0),
  memory: chartSeriesColor(2),
  disk: chartSeriesColor(3),
  billable: chartSeriesColor(0),
} as const;

export function chartPaletteVariables(mode: "light" | "dark") {
  return (mode === "dark" ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT)
    .map((color, index) => `--chart-series-${index + 1}: ${color};`)
    .join("\n");
}
