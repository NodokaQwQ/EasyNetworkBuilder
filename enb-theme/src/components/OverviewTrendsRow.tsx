import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { IconCheck } from "@/components/Icons";
import { useI18n, type MessageKey } from "@/i18n/locales";
import { useDashboardData } from "@/lib/DataContext";
import { formatBytesParts, formatSpeedParts } from "@/lib/format";
import {
  ALL_SERVERS_SERIES_KEY,
  fetchMultiNodePingDataset,
  fetchMultiNodeTrafficDataset,
  fetchPublicPingTasks,
  projectPingChartData,
  projectTrafficChartData,
  type MultiNodePingDataset,
  type MultiNodeTrafficDataset,
  type OverviewHoursWindow,
  type PingMetricMode,
  type PublicPingTask,
  type TrafficDirectionMode,
  type TrafficMetricMode,
} from "@/lib/rpc";
import { chartSeriesColor, useThemeMode } from "@/theme/tokens";

const HOURS_OPTIONS: Array<{ hours: OverviewHoursWindow; labelKey: MessageKey }> = [
  { hours: 1, labelKey: "range1h" },
  { hours: 6, labelKey: "range6h" },
  { hours: 12, labelKey: "range12h" },
  { hours: 24, labelKey: "range24h" },
  { hours: 168, labelKey: "range7d" },
];

function formatCompactTrafficAxis(val: number, mode: TrafficMetricMode): string {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (mode === "bytes") {
    const p = formatBytesParts(n, 1);
    return `${p.value.replace(/\.0$/, "")}${p.unit}`;
  }
  const p = formatSpeedParts(n);
  return `${Number(p.value).toFixed(Number(p.value) >= 10 ? 0 : 1)}${p.unit}`;
}

export const OverviewTrendsRow: React.FC = () => {
  const { nodes, publicSettings } = useDashboardData();
  const { t } = useI18n();
  const { resolved } = useThemeMode();

  const uuids = useMemo(() => nodes.map((n) => n.uuid), [nodes]);
  const uuidsKey = useMemo(() => uuids.join(","), [uuids]);

  // Deterministic MD3 24-color assignment shared across BOTH Left & Right charts:
  // Slot 0 -> All Servers (__all__), Slot (i + 1) -> nodes[i]
  const colorByEntity = useMemo(() => {
    const map: Record<string, string> = {
      [ALL_SERVERS_SERIES_KEY]: chartSeriesColor(0, resolved),
    };
    nodes.forEach((node, index) => {
      map[node.uuid] = chartSeriesColor(index + 1, resolved);
    });
    return map;
  }, [nodes, resolved]);

  const nameByEntity = useMemo(() => {
    const map: Record<string, string> = {
      [ALL_SERVERS_SERIES_KEY]: t("allServers"),
    };
    for (const node of nodes) {
      map[node.uuid] = node.name || node.uuid.slice(0, 8);
    }
    return map;
  }, [nodes, t]);

  // ---------------------------------------------------------------------------
  // Left Card State: Multi-Server + Fleet Traffic Line Chart
  // ---------------------------------------------------------------------------
  const [trafficHours, setTrafficHours] = useState<OverviewHoursWindow>(24);
  const [trafficMode, setTrafficMode] = useState<TrafficMetricMode>("bytes");
  const [trafficDir, setTrafficDir] = useState<TrafficDirectionMode>("both");
  const [trafficData, setTrafficData] = useState<MultiNodeTrafficDataset>({
    buckets: [],
    summaryByEntity: {},
  });
  const [trafficLoading, setTrafficLoading] = useState<boolean>(false);
  const [hiddenTrafficKeys, setHiddenTrafficKeys] = useState<Set<string>>(() => new Set());
  const [hoveredTrafficKey, setHoveredTrafficKey] = useState<string | null>(null);

  useEffect(() => {
    if (!uuidsKey) return;
    let cancelled = false;

    const load = (showSpinner: boolean) => {
      if (showSpinner) setTrafficLoading(true);
      void fetchMultiNodeTrafficDataset(uuids, trafficHours).then((next) => {
        if (!cancelled) {
          setTrafficData(next);
          setTrafficLoading(false);
        }
      });
    };

    load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [uuids, uuidsKey, trafficHours]);

  const projectedTraffic = useMemo(
    () => projectTrafficChartData(trafficData, uuids, trafficMode, trafficDir),
    [trafficData, uuids, trafficMode, trafficDir],
  );

  const trafficSeriesKeys = useMemo(
    () => [ALL_SERVERS_SERIES_KEY, ...uuids],
    [uuids],
  );

  const onlyTotalSelected = useMemo(() => {
    if (uuids.length === 0) return false;
    return (
      !hiddenTrafficKeys.has(ALL_SERVERS_SERIES_KEY) &&
      uuids.every((id) => hiddenTrafficKeys.has(id))
    );
  }, [hiddenTrafficKeys, uuids]);

  const toggleTrafficSeries = (key: string) => {
    setHiddenTrafficKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // Keep at least one series visible
        if (next.size < trafficSeriesKeys.length - 1) {
          next.add(key);
        }
      }
      return next;
    });
  };

  const toggleOnlyTotalTraffic = () => {
    if (onlyTotalSelected) {
      setHiddenTrafficKeys(new Set());
    } else {
      setHiddenTrafficKeys(new Set(uuids));
    }
  };

  const windowTotalBytesFmt = formatBytesParts(
    trafficDir === "up"
      ? trafficData.summaryByEntity[ALL_SERVERS_SERIES_KEY]?.upBytes
      : trafficDir === "down"
        ? trafficData.summaryByEntity[ALL_SERVERS_SERIES_KEY]?.downBytes
        : trafficData.summaryByEntity[ALL_SERVERS_SERIES_KEY]?.totalBytes,
  );

  // ---------------------------------------------------------------------------
  // Right Card State: Per-Server Latency / Packet Loss Line Chart
  // ---------------------------------------------------------------------------
  const [pingHours, setPingHours] = useState<OverviewHoursWindow>(24);
  const [pingMode, setPingMode] = useState<PingMetricMode>("latency");
  const [selectedTaskId, setSelectedTaskId] = useState<string>(ALL_SERVERS_SERIES_KEY);
  const [peakCut, setPeakCut] = useState<boolean>(
    Boolean(publicSettings.theme_settings?.ForcePeakCutEnabled),
  );
  const [pingTasks, setPingTasks] = useState<PublicPingTask[]>([]);
  const [pingData, setPingData] = useState<MultiNodePingDataset>({
    buckets: [],
    taskIds: [],
  });
  const [pingLoading, setPingLoading] = useState<boolean>(false);
  const [hiddenPingKeys, setHiddenPingKeys] = useState<Set<string>>(() => new Set());
  const [hoveredPingKey, setHoveredPingKey] = useState<string | null>(null);

  useEffect(() => {
    if (publicSettings.theme_settings?.ForcePeakCutEnabled !== undefined) {
      setPeakCut(Boolean(publicSettings.theme_settings.ForcePeakCutEnabled));
    }
  }, [publicSettings.theme_settings?.ForcePeakCutEnabled]);

  useEffect(() => {
    void fetchPublicPingTasks().then(setPingTasks);
  }, []);

  useEffect(() => {
    if (!uuidsKey) return;
    let cancelled = false;

    const load = (showSpinner: boolean) => {
      if (showSpinner) setPingLoading(true);
      void fetchMultiNodePingDataset(uuids, pingHours).then((next) => {
        if (!cancelled) {
          setPingData(next);
          setPingLoading(false);
        }
      });
    };

    load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [uuids, uuidsKey, pingHours]);

  const availableProbeTasks = useMemo(() => {
    const byId = new Map<string, string>();
    for (const task of pingTasks) {
      byId.set(String(task.id), task.name || `Task #${task.id}`);
    }
    for (const tid of pingData.taskIds) {
      if (!byId.has(tid)) {
        byId.set(tid, `Task #${tid}`);
      }
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [pingTasks, pingData.taskIds]);

  useEffect(() => {
    if (
      selectedTaskId !== ALL_SERVERS_SERIES_KEY &&
      availableProbeTasks.length > 0 &&
      !availableProbeTasks.some((item) => item.id === selectedTaskId)
    ) {
      setSelectedTaskId(ALL_SERVERS_SERIES_KEY);
    }
  }, [availableProbeTasks, selectedTaskId]);

  const projectedPing = useMemo(
    () => projectPingChartData(pingData, uuids, pingMode, selectedTaskId, peakCut),
    [pingData, uuids, pingMode, selectedTaskId, peakCut],
  );

  const togglePingSeries = (uid: string) => {
    setHiddenPingKeys((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else if (next.size < uuids.length - 1) {
        next.add(uid);
      }
      return next;
    });
  };

  const pingBadgeTone = useMemo(() => {
    const v = projectedPing.fleetAvg;
    if (v === null) return "enb-pill enb-pill-primary enb-mono";
    if (pingMode === "latency") {
      if (v >= 250) return "enb-pill enb-pill-error enb-mono";
      if (v >= 150) return "enb-pill enb-pill-warning enb-mono";
      return "enb-pill enb-pill-healthy enb-mono";
    }
    if (v >= 10) return "enb-pill enb-pill-error enb-mono";
    if (v >= 1.5) return "enb-pill enb-pill-warning enb-mono";
    return "enb-pill enb-pill-healthy enb-mono";
  }, [projectedPing.fleetAvg, pingMode]);

  if (nodes.length === 0) return null;

  return (
    <section className="enb-overview-trends-grid">
      {/* =================================================================== */}
      {/* LEFT 50%: Per-Server + All-Servers Traffic Trend Line Chart         */}
      {/* =================================================================== */}
      <article className="enb-trend-card">
        <div className="enb-trend-head">
          <div className="enb-trend-title-wrap">
            <h2 className="enb-trend-title">{t("trafficTrendTitle")}</h2>
            <span className="enb-pill enb-pill-primary enb-mono" style={{ height: 24, fontSize: 11.5 }}>
              {t("windowTotal", { value: windowTotalBytesFmt.full })}
            </span>
          </div>

          <div className="enb-mini-segmented" role="tablist">
            {HOURS_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                type="button"
                role="tab"
                aria-selected={trafficHours === opt.hours}
                className={trafficHours === opt.hours ? "is-active" : ""}
                onClick={() => setTrafficHours(opt.hours)}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="enb-trend-subbar">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <div className="enb-mini-segmented" role="group">
              <button
                type="button"
                className={trafficMode === "bytes" ? "is-active" : ""}
                onClick={() => setTrafficMode("bytes")}
              >
                {t("metricTrafficVolume")}
              </button>
              <button
                type="button"
                className={trafficMode === "rate" ? "is-active" : ""}
                onClick={() => setTrafficMode("rate")}
              >
                {t("metricTrafficRate")}
              </button>
            </div>

            <div className="enb-mini-segmented" role="group">
              <button
                type="button"
                className={trafficDir === "both" ? "is-active" : ""}
                onClick={() => setTrafficDir("both")}
              >
                {t("dirBoth")}
              </button>
              <button
                type="button"
                className={trafficDir === "up" ? "is-active" : ""}
                onClick={() => setTrafficDir("up")}
              >
                ↑ {t("upload")}
              </button>
              <button
                type="button"
                className={trafficDir === "down" ? "is-active" : ""}
                onClick={() => setTrafficDir("down")}
              >
                ↓ {t("download")}
              </button>
            </div>
          </div>

          {uuids.length > 1 ? (
            <button
              type="button"
              className={`enb-mini-chip-btn ${onlyTotalSelected ? "is-active" : ""}`}
              onClick={toggleOnlyTotalTraffic}
            >
              {onlyTotalSelected ? t("showAllSeries") : t("onlyTotalSeries")}
            </button>
          ) : null}
        </div>

        <div className="enb-trend-chart-box">
          {projectedTraffic.points.length === 0 ? (
            <div className="enb-trend-empty">
              {trafficLoading ? t("loading") : t("noTrafficSeriesData")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={projectedTraffic.points}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--enb-grid-stroke)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={38}
                  tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }}
                />
                <YAxis
                  width={56}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, "auto"]}
                  tickFormatter={(v) => formatCompactTrafficAxis(Number(v), trafficMode)}
                  tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }}
                />
                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const items = payload
                      .filter((p) => p.value !== null && p.value !== undefined)
                      .map((p) => ({
                        key: String(p.dataKey),
                        val: Number(p.value) || 0,
                        color: String(p.color || colorByEntity[String(p.dataKey)]),
                      }))
                      .sort((a, b) => {
                        if (a.key === ALL_SERVERS_SERIES_KEY) return -1;
                        if (b.key === ALL_SERVERS_SERIES_KEY) return 1;
                        return b.val - a.val;
                      });
                    if (items.length === 0) return null;

                    return (
                      <div className="enb-chart-tooltip" style={{ minWidth: 185, maxHeight: 280, overflowY: "auto" }}>
                        <div
                          className="enb-mono"
                          style={{
                            color: "var(--md-sys-color-on-surface-variant)",
                            marginBottom: 6,
                            fontSize: 11.5,
                          }}
                        >
                          {label}
                        </div>
                        {items.map((item) => {
                          const formatted =
                            trafficMode === "bytes"
                              ? formatBytesParts(item.val).full
                              : formatSpeedParts(item.val).full;
                          const isTotal = item.key === ALL_SERVERS_SERIES_KEY;
                          return (
                            <div
                              key={item.key}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 14,
                                padding: "2px 0",
                                borderBottom: isTotal
                                  ? "1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 55%, transparent)"
                                  : undefined,
                                marginBottom: isTotal ? 3 : 0,
                                fontWeight: isTotal ? 700 : 500,
                              }}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <i
                                  className="enb-series-dot"
                                  style={{ background: item.color }}
                                />
                                <span>{nameByEntity[item.key] ?? item.key}</span>
                              </span>
                              <span className="enb-mono" style={{ fontWeight: 600 }}>
                                {formatted}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }}
                />

                {trafficSeriesKeys.map((seriesKey) => {
                  if (hiddenTrafficKeys.has(seriesKey)) return null;
                  const isTotal = seriesKey === ALL_SERVERS_SERIES_KEY;
                  const isSpotlit = hoveredTrafficKey === seriesKey;
                  const isDimmed = hoveredTrafficKey !== null && !isSpotlit;
                  return (
                    <Line
                      key={seriesKey}
                      type="monotone"
                      dataKey={seriesKey}
                      name={nameByEntity[seriesKey] ?? seriesKey}
                      stroke={colorByEntity[seriesKey]}
                      strokeWidth={isSpotlit ? 2.9 : isTotal ? 2.5 : 1.75}
                      strokeOpacity={isDimmed ? 0.22 : 1}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="enb-series-legend">
          {trafficSeriesKeys.map((seriesKey) => {
            const muted = hiddenTrafficKeys.has(seriesKey);
            const rawVal = projectedTraffic.valueByEntity[seriesKey] ?? 0;
            const valLabel =
              trafficMode === "bytes"
                ? formatBytesParts(rawVal).full
                : formatSpeedParts(rawVal).full;
            return (
              <button
                key={seriesKey}
                type="button"
                className={`enb-series-chip ${muted ? "is-muted" : ""}`}
                onClick={() => toggleTrafficSeries(seriesKey)}
                onMouseEnter={() => !muted && setHoveredTrafficKey(seriesKey)}
                onMouseLeave={() => setHoveredTrafficKey(null)}
              >
                <span
                  className="enb-series-dot"
                  style={{ background: colorByEntity[seriesKey] }}
                />
                <span>{nameByEntity[seriesKey]}</span>
                <span className="enb-series-chip-val enb-mono">{valLabel}</span>
              </button>
            );
          })}
        </div>
      </article>

      {/* =================================================================== */}
      {/* RIGHT 50%: Per-Server Latency & Packet Loss Trend Line Chart        */}
      {/* =================================================================== */}
      <article className="enb-trend-card">
        <div className="enb-trend-head">
          <div className="enb-trend-title-wrap">
            <h2 className="enb-trend-title">{t("latencyLossTitle")}</h2>
            {projectedPing.fleetAvg !== null ? (
              <span className={pingBadgeTone} style={{ height: 24, fontSize: 11.5 }}>
                {pingMode === "latency"
                  ? t("fleetAvgLatency", { value: projectedPing.fleetAvg.toFixed(1) })
                  : t("fleetAvgLoss", { value: projectedPing.fleetAvg.toFixed(2) })}
              </span>
            ) : null}
          </div>

          <div className="enb-mini-segmented" role="tablist">
            {HOURS_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                type="button"
                role="tab"
                aria-selected={pingHours === opt.hours}
                className={pingHours === opt.hours ? "is-active" : ""}
                onClick={() => setPingHours(opt.hours)}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="enb-trend-subbar">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <div className="enb-mini-segmented" role="group">
              <button
                type="button"
                className={pingMode === "latency" ? "is-active" : ""}
                onClick={() => setPingMode("latency")}
              >
                {t("metricLatency")} (ms)
              </button>
              <button
                type="button"
                className={pingMode === "loss" ? "is-active" : ""}
                onClick={() => setPingMode("loss")}
              >
                {t("metricPacketLoss")} (%)
              </button>
            </div>

            {availableProbeTasks.length > 0 ? (
              <select
                className="enb-probe-select"
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                aria-label={t("allProbeTasks")}
              >
                <option value={ALL_SERVERS_SERIES_KEY}>{t("allProbeTasks")}</option>
                {availableProbeTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {pingMode === "latency" ? (
              <button
                type="button"
                className={`enb-mini-chip-btn ${peakCut ? "is-active" : ""}`}
                onClick={() => setPeakCut((v) => !v)}
              >
                {peakCut ? <IconCheck size={12} /> : null}
                <span>{t("peakCut")}</span>
              </button>
            ) : null}
            {hiddenPingKeys.size > 0 ? (
              <button
                type="button"
                className="enb-mini-chip-btn"
                onClick={() => setHiddenPingKeys(new Set())}
              >
                {t("showAllSeries")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="enb-trend-chart-box">
          {projectedPing.points.length === 0 ? (
            <div className="enb-trend-empty">
              {pingLoading ? t("loading") : t("noPingSeriesData")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={projectedPing.points}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--enb-grid-stroke)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={38}
                  tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }}
                />
                <YAxis
                  width={52}
                  axisLine={false}
                  tickLine={false}
                  domain={
                    pingMode === "loss"
                      ? [0, (dataMax: number) => Math.min(100, Math.max(5, Math.ceil((dataMax || 0) * 1.15)))]
                      : [0, "auto"]
                  }
                  tickFormatter={(v) =>
                    pingMode === "latency" ? `${Math.round(Number(v))}ms` : `${Number(v).toFixed(0)}%`
                  }
                  tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }}
                />
                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const items = payload
                      .filter((p) => p.value !== null && p.value !== undefined)
                      .map((p) => ({
                        key: String(p.dataKey),
                        val: Number(p.value),
                        color: String(p.color || colorByEntity[String(p.dataKey)]),
                      }))
                      .filter((item) => Number.isFinite(item.val))
                      .sort((a, b) =>
                        pingMode === "latency" ? a.val - b.val : b.val - a.val,
                      );
                    if (items.length === 0) return null;

                    return (
                      <div className="enb-chart-tooltip" style={{ minWidth: 180, maxHeight: 280, overflowY: "auto" }}>
                        <div
                          className="enb-mono"
                          style={{
                            color: "var(--md-sys-color-on-surface-variant)",
                            marginBottom: 6,
                            fontSize: 11.5,
                          }}
                        >
                          {label}
                        </div>
                        {items.map((item) => (
                          <div
                            key={item.key}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 14,
                              padding: "2px 0",
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <i
                                className="enb-series-dot"
                                style={{ background: item.color }}
                              />
                              <span>{nameByEntity[item.key] ?? item.key}</span>
                            </span>
                            <span className="enb-mono" style={{ fontWeight: 600 }}>
                              {pingMode === "latency"
                                ? `${item.val.toFixed(2)} ms`
                                : `${item.val.toFixed(2)}%`}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />

                {uuids.map((uid) => {
                  if (hiddenPingKeys.has(uid)) return null;
                  const isSpotlit = hoveredPingKey === uid;
                  const isDimmed = hoveredPingKey !== null && !isSpotlit;
                  return (
                    <Line
                      key={uid}
                      type="monotone"
                      dataKey={uid}
                      name={nameByEntity[uid] ?? uid}
                      stroke={colorByEntity[uid]}
                      strokeWidth={isSpotlit ? 2.8 : 1.9}
                      strokeOpacity={isDimmed ? 0.22 : 1}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="enb-series-legend">
          {uuids.map((uid) => {
            const muted = hiddenPingKeys.has(uid);
            const avg = projectedPing.avgByEntity[uid];
            const avgText =
              avg === null || avg === undefined
                ? "—"
                : pingMode === "latency"
                  ? `${avg.toFixed(1)}ms`
                  : `${avg.toFixed(1)}%`;
            return (
              <button
                key={uid}
                type="button"
                className={`enb-series-chip ${muted ? "is-muted" : ""}`}
                onClick={() => togglePingSeries(uid)}
                onMouseEnter={() => !muted && setHoveredPingKey(uid)}
                onMouseLeave={() => setHoveredPingKey(null)}
              >
                <span
                  className="enb-series-dot"
                  style={{ background: colorByEntity[uid] }}
                />
                <span>{nameByEntity[uid]}</span>
                <span className="enb-series-chip-val enb-mono">{avgText}</span>
              </button>
            );
          })}
        </div>
      </article>
    </section>
  );
};
