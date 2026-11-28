import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  clampPercent,
  computeCycleTrafficUsed,
  computeResetDaysLeft,
  formatBytesParts,
  formatCurrencySymbol,
  formatSpeedParts,
  parseNodeTags,
  resolveCountryCode,
  shortOsName,
} from "../src/lib/format";
import {
  ALL_SERVERS_SERIES_KEY,
  buildMultiNodePingDataset,
  buildMultiNodeTrafficDataset,
  projectPingChartData,
  projectTrafficChartData,
  type MetricSeries,
} from "../src/lib/rpc";
import {
  CHART_PALETTE_DARK,
  CHART_PALETTE_LIGHT,
  chartSeriesColor,
} from "../src/theme/tokens";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themeRoot = path.resolve(__dirname, "..");

test("enb-theme manifest and MD3 design tokens match the Material You specification", () => {
  const manifestRaw = fs.readFileSync(path.join(themeRoot, "Lite-theme.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    name: string;
    short: string;
    version: string;
    preview: string;
    navigation: {
      server_detail: string;
      server_network: string;
      ping_task_parameter: string;
    };
    configuration: { type: string; data: unknown[] };
  };

  assert.equal(manifest.name, "ENB Material You");
  assert.equal(manifest.short, "enb-theme");
  assert.equal(manifest.preview, "preview.png");
  assert.equal(manifest.navigation.server_detail, "/server/{uuid}");
  assert.equal(manifest.navigation.server_network, "/server/{uuid}?view=network");
  assert.equal(manifest.navigation.ping_task_parameter, "ping_task");
  assert.equal(manifest.configuration.type, "managed");
  assert.ok(Array.isArray(manifest.configuration.data) && manifest.configuration.data.length >= 6);

  const css = fs.readFileSync(path.join(themeRoot, "src/styles/md3.css"), "utf8");
  for (const expectedToken of [
    "--md-sys-color-primary: #5845FF;",
    "--md-sys-color-surface: #F9F8FC;",
    "--md-sys-color-primary: #ACA3FF;",
    "--md-sys-color-surface: #111118;",
    "--md-sys-shape-card: 20px;",
    "--md-sys-shape-xl: 28px;",
    "--ops-color-healthy: #10B981;",
    "--ops-color-warning: #F59E0B;",
  ]) {
    assert.ok(css.includes(expectedToken), `missing expected MD3 token: ${expectedToken}`);
  }
});

test("24-color MD3 chart palettes cover light and dark modes with deterministic wraparound", () => {
  assert.equal(CHART_PALETTE_LIGHT.length, 24);
  assert.equal(CHART_PALETTE_DARK.length, 24);
  assert.equal(new Set(CHART_PALETTE_LIGHT).size, 24);
  assert.equal(new Set(CHART_PALETTE_DARK).size, 24);
  assert.equal(chartSeriesColor(0, "light"), "#5845FF");
  assert.equal(chartSeriesColor(0, "dark"), "#9D92FF");
  assert.equal(chartSeriesColor(24, "light"), CHART_PALETTE_LIGHT[0]);
  assert.equal(chartSeriesColor(-1, "dark"), CHART_PALETTE_DARK[23]);
});

test("traffic, speed, cycle billing, and region flag helpers format values accurately", () => {
  assert.deepEqual(formatBytesParts(0), { value: "0.00", unit: "B", full: "0 B" });
  assert.deepEqual(formatBytesParts(1536), { value: "1.50", unit: "KB", full: "1.50 KB" });
  assert.deepEqual(formatSpeedParts(605_460), {
    value: "591.3",
    unit: "K/s",
    full: "591.3 K/s",
  });
  assert.equal(clampPercent(150, 300), 50);
  assert.equal(clampPercent(400, 300), 100);

  assert.equal(computeCycleTrafficUsed("sum", 70, 80), 150);
  assert.equal(computeCycleTrafficUsed("max", 70, 80), 80);
  assert.equal(computeCycleTrafficUsed("min", 70, 80), 70);
  assert.equal(computeCycleTrafficUsed("up", 70, 80), 70);
  assert.equal(computeCycleTrafficUsed("down", 70, 80), 80);

  const inFiveDays = new Date(Date.now() + 5 * 86_400_000 - 10_000).toISOString();
  assert.equal(computeResetDaysLeft(inFiveDays, null), 5);

  assert.equal(resolveCountryCode("🇲🇾"), "MY");
  assert.equal(resolveCountryCode("🇺🇸"), "US");
  assert.equal(resolveCountryCode("🇨🇳"), "CN");
  assert.equal(resolveCountryCode("hk"), "HK");
  assert.equal(resolveCountryCode("UK"), "GB");
  assert.equal(resolveCountryCode("新加坡"), "SG");
  assert.equal(resolveCountryCode(""), "UN");

  assert.equal(shortOsName("Alpine Linux v3.21"), "Alpine");
  assert.equal(formatCurrencySymbol("CNY", "USD", "¥"), "¥");
  assert.equal(formatCurrencySymbol("CNY", "USD", "CNY"), "CNY ");
  assert.deepEqual(parseNodeTags("CN2 GIA; BGP, Premium"), ["CN2 GIA", "BGP", "Premium"]);
});

test("multi-node traffic dataset aggregates per-server and all-servers series across modes and directions", () => {
  const t1 = "2026-11-28T10:00:00Z";
  const t2 = "2026-11-28T10:05:00Z";
  const series: MetricSeries[] = [
    {
      metric_key: "traffic.up",
      entity_id: "node-a",
      interval_seconds: 300,
      points: [
        { time: t1, value: 1000 },
        { time: t2, value: 2000 },
      ],
    },
    {
      metric_key: "traffic.down",
      entity_id: "node-a",
      interval_seconds: 300,
      points: [
        { time: t1, value: 3000 },
        { time: t2, value: 4000 },
      ],
    },
    {
      metric_key: "traffic.up",
      entity_id: "node-b",
      interval_seconds: 300,
      points: [
        { time: t1, value: 500 },
        { time: t2, value: 1500 },
      ],
    },
    {
      metric_key: "traffic.down",
      entity_id: "node-b",
      interval_seconds: 300,
      points: [
        { time: t1, value: 1500 },
        { time: t2, value: 2500 },
      ],
    },
  ];

  const dataset = buildMultiNodeTrafficDataset(series, ["node-a", "node-b"], 6);
  assert.equal(dataset.buckets.length, 2);
  assert.equal(dataset.summaryByEntity["node-a"].totalBytes, 10_000);
  assert.equal(dataset.summaryByEntity["node-b"].totalBytes, 6_000);
  assert.equal(dataset.summaryByEntity[ALL_SERVERS_SERIES_KEY].totalBytes, 16_000);

  const bothBytes = projectTrafficChartData(dataset, ["node-a", "node-b"], "bytes", "both");
  assert.equal(bothBytes.points[0]["node-a"], 4000);
  assert.equal(bothBytes.points[0]["node-b"], 2000);
  assert.equal(bothBytes.points[0][ALL_SERVERS_SERIES_KEY], 6000);
  assert.equal(bothBytes.points[1][ALL_SERVERS_SERIES_KEY], 10_000);

  const upOnly = projectTrafficChartData(dataset, ["node-a", "node-b"], "bytes", "up");
  assert.equal(upOnly.points[0][ALL_SERVERS_SERIES_KEY], 1500);
  assert.equal(upOnly.valueByEntity[ALL_SERVERS_SERIES_KEY], 5000);
});

test("multi-node ping dataset projects latency, packet loss, probe filters, and 100%-loss gaps", () => {
  const t1 = "2026-11-28T10:00:00Z";
  const t2 = "2026-11-28T10:05:00Z";
  const series: MetricSeries[] = [
    {
      metric_key: "ping.latency_ms",
      entity_id: "node-a",
      interval_seconds: 300,
      tags: { task_id: "1" },
      points: [
        { time: t1, value: 40, count: 4 },
        { time: t2, value: 0, count: 4 }, // 100% loss bucket comes back as 0 latency + 1.0 loss
      ],
    },
    {
      metric_key: "ping.loss",
      entity_id: "node-a",
      interval_seconds: 300,
      tags: { task_id: "1" },
      points: [
        { time: t1, value: 0, count: 4 },
        { time: t2, value: 1, count: 4 },
      ],
    },
    {
      metric_key: "ping.latency_ms",
      entity_id: "node-b",
      interval_seconds: 300,
      tags: { task_id: "2" },
      points: [
        { time: t1, value: 120, count: 4 },
        { time: t2, value: 130, count: 4 },
      ],
    },
    {
      metric_key: "ping.loss",
      entity_id: "node-b",
      interval_seconds: 300,
      tags: { task_id: "2" },
      points: [
        { time: t1, value: 0.25, count: 4 },
        { time: t2, value: 0, count: 4 },
      ],
    },
  ];

  const dataset = buildMultiNodePingDataset(series, ["node-a", "node-b"], 6);
  assert.deepEqual(dataset.taskIds, ["1", "2"]);

  const latencyAll = projectPingChartData(
    dataset,
    ["node-a", "node-b"],
    "latency",
    ALL_SERVERS_SERIES_KEY,
    false,
  );
  assert.equal(latencyAll.points[0]["node-a"], 40);
  assert.equal(latencyAll.points[1]["node-a"], null); // 100% packet loss bucket must not plot 0ms
  assert.equal(latencyAll.points[0]["node-b"], 120);
  assert.equal(latencyAll.points[1]["node-b"], 130);

  const lossAll = projectPingChartData(
    dataset,
    ["node-a", "node-b"],
    "loss",
    ALL_SERVERS_SERIES_KEY,
    false,
  );
  assert.equal(lossAll.points[0]["node-a"], 0);
  assert.equal(lossAll.points[1]["node-a"], 100);
  assert.equal(lossAll.points[0]["node-b"], 25);
  assert.equal(lossAll.avgByEntity["node-a"], 50);

  const taskOneOnly = projectPingChartData(
    dataset,
    ["node-a", "node-b"],
    "latency",
    "1",
    false,
  );
  assert.equal(taskOneOnly.points[0]["node-a"], 40);
  assert.equal(taskOneOnly.points[0]["node-b"], null);
});
