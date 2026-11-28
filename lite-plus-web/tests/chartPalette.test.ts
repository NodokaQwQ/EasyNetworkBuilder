import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHART_COLORS,
  CHART_PALETTE_DARK,
  CHART_PALETTE_LIGHT,
  chartPaletteVariables,
  chartSeriesColor,
} from "../src/theme/chartPalette.ts";

test("chart palettes preserve all 24 ordered light and dark specification colors", () => {
  const light = "5845FF EC4899 06B6D4 10B981 8B5CF6 3B82F6 D946EF F43F5E 14B8A6 6366F1 0EA5E9 A855F7 FB7185 22D3EE 34D399 7C3AED F472B6 60A5FA C026D3 2DD4BF 818CF8 38BDF8 E879F9 4ADE80";
  const dark = "9D92FF FF9ED2 6EE7F5 73F2BE C4B5FD 8EC5FF F5A6FF FF9CB0 6EF0DC A5B4FC 7AD7FF D8B4FE FECDD3 A5F3FC A7F3D0 B59CFF FBCFE8 BFDBFE E89BFF 99F6E4 C7D2FE BAE6FD F5D0FE BBF7D0";
  assert.deepEqual(CHART_PALETTE_LIGHT, light.split(" ").map((hex) => `#${hex}`));
  assert.deepEqual(CHART_PALETTE_DARK, dark.split(" ").map((hex) => `#${hex}`));
  for (const palette of [CHART_PALETTE_LIGHT, CHART_PALETTE_DARK]) {
    assert.equal(palette.length, 24);
    assert.equal(new Set(palette).size, 24);
    palette.forEach((color) => assert.match(color, /^#[\dA-F]{6}$/));
  }
});

test("series indices are stable, bounded and share semantic aliases", () => {
  CHART_PALETTE_LIGHT.forEach((color, index) => {
    assert.equal(chartSeriesColor(index), `var(--chart-series-${index + 1}, ${color})`);
    assert.equal(chartSeriesColor(index + 24), chartSeriesColor(index));
  });
  assert.equal(chartSeriesColor(-1), chartSeriesColor(23));
  assert.equal(chartSeriesColor(1.9), chartSeriesColor(1));
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(chartSeriesColor(invalid), chartSeriesColor(0));
  }
  assert.equal(CHART_COLORS.inbound, chartSeriesColor(0));
  assert.equal(CHART_COLORS.outbound, chartSeriesColor(1));
  assert.equal(CHART_COLORS.cpu, chartSeriesColor(0));
  assert.equal(CHART_COLORS.memory, chartSeriesColor(2));
  assert.equal(CHART_COLORS.disk, chartSeriesColor(3));
});

test("theme tokens cover all series and remain scoped to the admin shell including portals", () => {
  for (const [mode, palette] of [["light", CHART_PALETTE_LIGHT], ["dark", CHART_PALETTE_DARK]] as const) {
    const variables = chartPaletteVariables(mode).split("\n");
    assert.equal(variables.length, 24);
    palette.forEach((color, index) => assert.equal(variables[index], `--chart-series-${index + 1}: ${color};`));
  }
  const tokens = readFileSync("src/components/admin/AdminChartTokens.tsx", "utf8");
  const shell = readFileSync("src/components/admin/shell/AdminShell.tsx", "utf8");
  assert.match(tokens, /html\[data-admin-shell-active="true"\] \{ \$\{chartPaletteVariables\("light"\)\}/);
  assert.match(tokens, /html\.dark\[data-admin-shell-active="true"\] \{ \$\{chartPaletteVariables\("dark"\)\}/);
  assert.match(shell, /<AdminChartTokens \/>/);
});

test("area charts use unique 20 percent to zero gradients without Recharts dimming", () => {
  const gradient = readFileSync("src/components/admin/ChartGradient.tsx", "utf8");
  assert.match(gradient, /x1="0" y1="0" x2="0" y2="1"/);
  assert.match(gradient, /offset="0%" stopColor=\{color\} stopOpacity=\{0\.2\}/);
  assert.match(gradient, /offset="100%" stopColor=\{color\} stopOpacity=\{0\}/);
  const source = readFileSync("src/pages/admin/NodeUsageStats.tsx", "utf8");
  assert.match(source, /useId\(\)/);
  const areas = source.match(/<Area\s[^>]*\/>/g) ?? [];
  assert.ok(areas.length >= 2);
  areas.forEach((area) => {
    assert.match(area, /fill=\{`url\(#\$\{gradientId\}/);
    assert.match(area, /fillOpacity=\{1\}/);
    assert.match(area, /strokeWidth=\{2\}/);
  });
});

test("dashboard traffic statistics, stacked billing, and dual latency-loss charts use specification palette", () => {
  const dashboard = readFileSync("src/components/admin/DashboardPanels.tsx", "utf8");
  const latency = dashboard.slice(
    dashboard.indexOf("export function LatencyPanel"),
    dashboard.indexOf("export function ReturnRouteStatusPanel"),
  );
  assert.match(latency, /dataKey="average"/);
  assert.match(latency, /dataKey="loss_rate"/);
  assert.match(latency, /CHART_COLORS\.inbound/);
  assert.match(latency, /CHART_COLORS\.outbound/);

  const traffic = dashboard.slice(
    dashboard.indexOf("export function TrafficTrendPanel"),
    dashboard.indexOf("export function DailyTrafficRankingPanel"),
  );
  assert.match(traffic, /chartSeriesColor\(idx\)/);
  assert.match(traffic, /<LineChart/);

  const billing = readFileSync("src/components/admin/DashboardTraffic30d.tsx", "utf8");
  assert.match(billing, /stackId="billable"/);
  assert.match(billing, /chartSeriesColor\(idx\)/);

  const node = readFileSync("src/pages/admin/NodeUsageStats.tsx", "utf8");
  assert.match(node, /<Cell fill=\{CHART_COLORS\.inbound\}/);
  assert.match(node, /<Cell fill=\{CHART_COLORS\.outbound\}/);
  assert.match(node, /paddingAngle=\{3\}/);
  assert.match(node, /cornerRadius=\{4\}/);
  assert.doesNotMatch(node, /LITE_BLUE|#FFAB00|#2065D1/);
});

test("chart chrome uses subdued horizontal grids, mono numbers and theme-aware tooltips", () => {
  const css = readFileSync("src/adminMaterial.css", "utf8");
  assert.match(css, /--chart-grid-line: rgba\(115, 112, 143, \.18\)/);
  assert.match(css, /--chart-grid-line: rgba\(186, 184, 204, \.14\)/);
  assert.match(css, /--chart-tooltip-bg: #dcdae7/);
  assert.match(css, /--chart-tooltip-bg: #323040/);
  assert.match(css, /\.recharts-cartesian-grid-horizontal line\s*\{[^}]*stroke-dasharray: 4 4/);
  assert.match(css, /\.recharts-cartesian-grid-vertical,[\s\S]*?display: none/);
  assert.match(css, /\.recharts-cartesian-axis-tick text,[\s\S]*?font-variant-numeric: tabular-nums/);
  assert.match(css, /\.recharts-tooltip-wrapper > div\s*\{[^}]*background: var\(--chart-tooltip-bg\) !important;[^}]*border-radius: 12px !important/);
});
