import React, { useEffect, useId, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartGradient } from "@/components/ChartGradient";
import { FlagIcon } from "@/components/FlagIcon";
import {
  IconArrowLeft,
  IconCheck,
  IconPulse,
  IconServer,
} from "@/components/Icons";
import { useI18n } from "@/i18n/locales";
import { useDashboardData } from "@/lib/DataContext";
import {
  clampPercent,
  computeCycleTrafficUsed,
  computeExpiryDaysLeft,
  formatBytesParts,
  formatCurrencySymbol,
  formatSpeedParts,
  formatUptime,
  isLongTermDate,
} from "@/lib/format";
import {
  fetchNodePingHistory,
  fetchNodeResourceHistory,
  type ProbeHistoryDataset,
  type ResourceHistoryPoint,
} from "@/lib/rpc";
import { chartSeriesColor, useThemeMode } from "@/theme/tokens";

type DetailViewTab = "detail" | "network";
type HoursWindow = 0 | 1 | 6 | 12 | 24 | 168;

export const ServerDetailPage: React.FC = () => {
  const { uuid = "" } = useParams<{ uuid: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { nodes, statuses, publicSettings, loading } = useDashboardData();
  const { t } = useI18n();
  const { resolved } = useThemeMode();
  const chartUid = useId().replace(/:/g, "");

  const activeTab: DetailViewTab =
    searchParams.get("view") === "network" ? "network" : "detail";
  const initialPingTask = searchParams.get("ping_task") || "";

  const [resHours, setResHours] = useState<HoursWindow>(1);
  const [netHours, setNetHours] = useState<1 | 6 | 12 | 24 | 168>(1);
  const [peakCut, setPeakCut] = useState<boolean>(
    Boolean(publicSettings.theme_settings?.ForcePeakCutEnabled),
  );
  const [selectedTasks, setSelectedTasks] = useState<string[]>(
    initialPingTask ? [initialPingTask] : [],
  );

  const [resHistory, setResHistory] = useState<ResourceHistoryPoint[]>([]);
  const [liveBuffer, setLiveBuffer] = useState<ResourceHistoryPoint[]>([]);
  const [pingDataset, setPingDataset] = useState<ProbeHistoryDataset>({
    tasks: [],
    points: [],
  });
  const [loadingChart, setLoadingChart] = useState(false);

  useEffect(() => {
    if (publicSettings.theme_settings?.ForcePeakCutEnabled !== undefined) {
      setPeakCut(Boolean(publicSettings.theme_settings.ForcePeakCutEnabled));
    }
  }, [publicSettings.theme_settings?.ForcePeakCutEnabled]);

  useEffect(() => {
    const paramTask = searchParams.get("ping_task");
    if (paramTask) {
      setSelectedTasks([paramTask]);
    }
  }, [searchParams]);

  const node = useMemo(
    () => nodes.find((item) => item.uuid === uuid),
    [nodes, uuid],
  );
  const status = statuses[uuid];
  const online = Boolean(status?.online);

  // Append live status points for "Realtime" window
  useEffect(() => {
    if (!status) return;
    const now = Date.now();
    const memTot = Number(status.ram_total || node?.mem_total) || 0;
    const diskTot = Number(status.disk_total || node?.disk_total) || 0;
    const pt: ResourceHistoryPoint = {
      time: now,
      label: new Date(now).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
      cpu: Math.max(0, Number(status.cpu) || 0),
      memPct: clampPercent(status.ram, memTot),
      diskPct: clampPercent(status.disk, diskTot),
      netIn: Math.max(0, Number(status.net_in) || 0),
      netOut: Math.max(0, Number(status.net_out) || 0),
      load: Math.max(0, Number(status.load) || 0),
      connections: Math.max(0, Number(status.connections) || 0),
      process: Math.max(0, Number(status.process) || 0),
    };
    setLiveBuffer((prev) => [...prev.slice(-39), pt]);
  }, [status, node?.mem_total, node?.disk_total]);

  // Fetch historical resource records
  useEffect(() => {
    if (!uuid || activeTab !== "detail" || resHours === 0) return;
    let cancelled = false;
    setLoadingChart(true);
    void fetchNodeResourceHistory(
      uuid,
      resHours,
      Number(status?.ram_total || node?.mem_total) || 0,
      Number(status?.disk_total || node?.disk_total) || 0,
    )
      .then((pts) => {
        if (!cancelled) setResHistory(pts);
      })
      .finally(() => {
        if (!cancelled) setLoadingChart(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uuid, activeTab, resHours, node?.mem_total, node?.disk_total, status?.ram_total, status?.disk_total]);

  // Fetch historical ping records
  useEffect(() => {
    if (!uuid || activeTab !== "network") return;
    let cancelled = false;
    setLoadingChart(true);
    void fetchNodePingHistory(uuid, netHours)
      .then((data) => {
        if (!cancelled) setPingDataset(data);
      })
      .finally(() => {
        if (!cancelled) setLoadingChart(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uuid, activeTab, netHours]);

  const switchTab = (next: DetailViewTab) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "network") p.set("view", "network");
      else {
        p.delete("view");
        p.delete("ping_task");
      }
      return p;
    });
  };

  // Peak-cut transformation on multi-series latency chart
  const chartPingPoints = useMemo(() => {
    if (!peakCut || pingDataset.points.length === 0) return pingDataset.points;
    const allValues: number[] = [];
    for (const row of pingDataset.points) {
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith("task_") && typeof v === "number" && Number.isFinite(v)) {
          allValues.push(v);
        }
      }
    }
    if (allValues.length < 8) return pingDataset.points;
    allValues.sort((a, b) => a - b);
    const p95 = allValues[Math.floor((allValues.length - 1) * 0.95)];
    const ceiling = Math.max(30, p95 * 1.35);
    return pingDataset.points.map((row) => {
      const copy: Record<string, number | string | null> = { ...row };
      for (const [k, v] of Object.entries(copy)) {
        if (k.startsWith("task_") && typeof v === "number" && v > ceiling) {
          copy[k] = Number(ceiling.toFixed(2));
        }
      }
      return copy;
    });
  }, [peakCut, pingDataset.points]);

  const visiblePingTasks = useMemo(() => {
    if (selectedTasks.length === 0) return pingDataset.tasks;
    const filtered = pingDataset.tasks.filter((item) =>
      selectedTasks.includes(item.id),
    );
    return filtered.length > 0 ? filtered : pingDataset.tasks;
  }, [pingDataset.tasks, selectedTasks]);

  const routeSummary = useMemo(() => {
    if (visiblePingTasks.length === 0) return null;
    const withAvg = visiblePingTasks.filter(
      (x) => x.avg !== null && x.avg > 0,
    );
    const best =
      [...withAvg].sort((a, b) => (a.avg ?? 9999) - (b.avg ?? 9999))[0] ??
      visiblePingTasks[0];
    const avgAvailability =
      100 -
      visiblePingTasks.reduce((acc, x) => acc + (x.loss || 0), 0) /
        visiblePingTasks.length;
    const minVal = withAvg.reduce(
      (min, x) => (x.min !== null && x.min > 0 && x.min < min ? x.min : min),
      Infinity,
    );
    const meanAvg =
      withAvg.length > 0
        ? withAvg.reduce((s, x) => s + (x.avg || 0), 0) / withAvg.length
        : null;
    return {
      bestName: best?.name || "—",
      availability: Math.max(0, Math.min(100, avgAvailability)),
      minLatency: Number.isFinite(minVal) ? minVal : null,
      avgLatency: meanAvg,
    };
  }, [visiblePingTasks]);

  if (!node) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <Link to="/" className="enb-btn enb-btn-outlined">
            <IconArrowLeft />
            <span>{t("backToList")}</span>
          </Link>
        </div>
        <div
          style={{
            padding: "56px 24px",
            textAlign: "center",
            borderRadius: "var(--md-sys-shape-xl)",
            background: "var(--enb-card-bg)",
            border: "1px solid var(--md-sys-color-outline-variant)",
            color: "var(--md-sys-color-on-surface-variant)",
          }}
        >
          {loading ? t("loading") : t("notFound")}
        </div>
      </div>
    );
  }

  const cpuColor = chartSeriesColor(0, resolved);
  const memColor = chartSeriesColor(4, resolved);
  const diskColor = chartSeriesColor(6, resolved);
  const downColor = chartSeriesColor(3, resolved);
  const loadColor = chartSeriesColor(2, resolved);

  const memTot = Number(status?.ram_total || node.mem_total) || 0;
  const diskTot = Number(status?.disk_total || node.disk_total) || 0;
  const swapTot = Number(status?.swap_total || node.swap_total) || 0;
  const quotaLimit = Math.max(
    0,
    Number(node.effective_traffic_limit || node.traffic_limit) || 0,
  );
  const cycleUsed = computeCycleTrafficUsed(
    node.effective_traffic_type || node.traffic_limit_type,
    status?.net_total_up ?? 0,
    status?.net_total_down ?? 0,
  );
  const quotaPct = quotaLimit > 0 ? clampPercent(cycleUsed, quotaLimit) : 0;
  const expDays = computeExpiryDaysLeft(node.expired_at);
  const longTerm = isLongTermDate(node.expired_at);
  const currencySym = formatCurrencySymbol(
    node.currency,
    publicSettings.theme_settings?.DefaultBillingCurrency,
    publicSettings.theme_settings?.CnySymbolStyle,
  );

  const activeResPoints = resHours === 0 ? liveBuffer : resHistory;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Back Button */}
      <div>
        <Link to="/" className="enb-btn enb-btn-outlined">
          <IconArrowLeft size={16} />
          <span>{t("backToList")}</span>
        </Link>
      </div>

      {/* Node Identity Hero Card (28px MD3 XL) */}
      <section className="enb-hero-card" style={{ padding: "22px 26px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            paddingBottom: 18,
            borderBottom: "1px solid var(--md-sys-color-outline-variant)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <FlagIcon region={node.region_override || node.region} size={32} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{node.name}</h1>
                <span className={`enb-pill ${online ? "enb-pill-healthy" : "enb-pill-error"}`}>
                  <span className="enb-pill-dot" />
                  {online ? t("online") : t("offline")}
                </span>
                {node.group ? (
                  <span className="enb-pill enb-pill-primary">{node.group}</span>
                ) : null}
              </div>
              <div
                style={{
                  marginTop: 5,
                  fontSize: 13,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {[node.cpu_name, node.os, node.kernel_version]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </div>

          {/* Live Throughput Summary */}
          <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11.5, color: cpuColor, fontWeight: 600 }}>
                ↑ {t("upload")}
              </div>
              <div className="enb-mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {formatSpeedParts(online ? status?.net_out : 0).full}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: downColor, fontWeight: 600 }}>
                ↓ {t("download")}
              </div>
              <div className="enb-mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {formatSpeedParts(online ? status?.net_in : 0).full}
              </div>
            </div>
          </div>
        </div>

        {/* Spec Tiles Grid */}
        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
            gap: 12,
          }}
        >
          {[
            [
              t("arch"),
              [node.arch, node.virtualization].filter(Boolean).join(" / ") || "—",
            ],
            [
              t("cpuModel"),
              node.cpu_cores ? `${node.cpu_cores} vCPU` : "—",
            ],
            [
              t("mem"),
              `${formatBytesParts(status?.ram ?? 0).full} / ${formatBytesParts(memTot).full}`,
            ],
            [
              t("swap"),
              swapTot > 0
                ? `${formatBytesParts(status?.swap ?? 0).full} / ${formatBytesParts(swapTot).full}`
                : "—",
            ],
            [
              t("disk"),
              `${formatBytesParts(status?.disk ?? 0).full} / ${formatBytesParts(diskTot).full}`,
            ],
            [t("uptime"), formatUptime(status?.uptime, t)],
            [
              t("usedTraffic"),
              quotaLimit > 0
                ? `${formatBytesParts(cycleUsed).full} / ${formatBytesParts(quotaLimit).full} (${quotaPct.toFixed(1)}%)`
                : formatBytesParts(cycleUsed).full,
            ],
            [
              t("cycleBilling"),
              longTerm || expDays === null
                ? t("longTerm")
                : expDays <= 0
                  ? t("expired")
                  : `${node.price && node.price > 0 ? `${currencySym}${node.price.toFixed(2)} · ` : ""}${t("remainingDays", { days: expDays })}`,
            ],
          ].map(([label, val]) => (
            <div
              key={label}
              style={{
                padding: "12px 14px",
                borderRadius: "var(--md-sys-shape-md)",
                background: "var(--enb-card-sub-bg)",
                border: "1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 55%, transparent)",
              }}
            >
              <div style={{ fontSize: 11.5, color: "var(--md-sys-color-on-surface-variant)" }}>
                {label}
              </div>
              <div
                className="enb-mono"
                style={{
                  marginTop: 4,
                  fontSize: 13.5,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={val}
              >
                {val}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Primary MD3 Tabs */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div className="enb-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "detail"}
            className={`enb-tab ${activeTab === "detail" ? "is-active" : ""}`}
            onClick={() => switchTab("detail")}
          >
            <IconServer size={16} />
            <span>{t("tabDetail")}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "network"}
            className={`enb-tab ${activeTab === "network" ? "is-active" : ""}`}
            onClick={() => switchTab("network")}
          >
            <IconPulse size={16} />
            <span>{t("tabNetwork")}</span>
          </button>
        </div>

        {activeTab === "detail" ? (
          <div className="enb-segmented">
            {(
              [
                [0, t("rangeRealtime")],
                [1, t("range1h")],
                [6, t("range6h")],
                [12, t("range12h")],
                [24, t("range24h")],
                [168, t("range7d")],
              ] as Array<[HoursWindow, string]>
            ).map(([h, label]) => (
              <button
                key={h}
                type="button"
                className={resHours === h ? "is-active" : ""}
                onClick={() => setResHours(h)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <button
                type="button"
                role="switch"
                aria-checked={peakCut}
                className={`enb-switch ${peakCut ? "is-checked" : ""}`}
                onClick={() => setPeakCut((v) => !v)}
              >
                <span className="enb-switch-thumb" />
              </button>
              <span>{t("peakCut")}</span>
            </label>

            <div className="enb-segmented">
              {(
                [
                  [1, t("range1h")],
                  [6, t("range6h")],
                  [12, t("range12h")],
                  [24, t("range24h")],
                  [168, t("range7d")],
                ] as Array<[1 | 6 | 12 | 24 | 168, string]>
              ).map(([h, label]) => (
                <button
                  key={h}
                  type="button"
                  className={netHours === h ? "is-active" : ""}
                  onClick={() => setNetHours(h)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === "detail" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 16,
          }}
        >
          {/* CPU Chart */}
          <div
            style={{
              background: "var(--enb-card-bg)",
              border: "1px solid var(--md-sys-color-outline-variant)",
              borderRadius: "var(--md-sys-shape-card)",
              padding: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t("cpuUsage")}</span>
              <span className="enb-mono" style={{ color: cpuColor, fontWeight: 700 }}>
                {Number(status?.cpu || 0).toFixed(1)}%
              </span>
            </div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activeResPoints}>
                  <defs>
                    <ChartGradient id={`${chartUid}-cpu`} color={cpuColor} />
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--enb-grid-stroke)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={40} tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} width={36} tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }} />
                  <Tooltip
                    isAnimationActive={false}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="enb-chart-tooltip enb-mono">
                          <div style={{ color: "var(--md-sys-color-on-surface-variant)" }}>{label}</div>
                          <div style={{ color: cpuColor, fontWeight: 700, marginTop: 3 }}>
                            CPU: {Number(payload[0]?.value || 0).toFixed(1)}%
                          </div>
                        </div>
                      ) : null
                    }
                  />
                  <Area type="monotone" dataKey="cpu" stroke={cpuColor} strokeWidth={2} fill={`url(#${chartUid}-cpu)`} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Memory & Disk Chart */}
          <div
            style={{
              background: "var(--enb-card-bg)",
              border: "1px solid var(--md-sys-color-outline-variant)",
              borderRadius: "var(--md-sys-shape-card)",
              padding: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {t("memUsage")} / {t("diskUsage")}
              </span>
              <span className="enb-mono" style={{ fontSize: 12.5 }}>
                <span style={{ color: memColor, fontWeight: 700 }}>
                  {clampPercent(status?.ram, memTot).toFixed(1)}%
                </span>
                {" · "}
                <span style={{ color: diskColor, fontWeight: 700 }}>
                  {clampPercent(status?.disk, diskTot).toFixed(1)}%
                </span>
              </span>
            </div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activeResPoints}>
                  <defs>
                    <ChartGradient id={`${chartUid}-mem`} color={memColor} />
                    <ChartGradient id={`${chartUid}-disk`} color={diskColor} topOpacity={0.18} />
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--enb-grid-stroke)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={40} tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} width={36} tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }} />
                  <Tooltip
                    isAnimationActive={false}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="enb-chart-tooltip enb-mono">
                          <div style={{ color: "var(--md-sys-color-on-surface-variant)" }}>{label}</div>
                          <div style={{ color: memColor, fontWeight: 600, marginTop: 3 }}>
                            {t("mem")}: {Number(payload.find((x) => x.dataKey === "memPct")?.value || 0).toFixed(1)}%
                          </div>
                          <div style={{ color: diskColor, fontWeight: 600 }}>
                            {t("disk")}: {Number(payload.find((x) => x.dataKey === "diskPct")?.value || 0).toFixed(1)}%
                          </div>
                        </div>
                      ) : null
                    }
                  />
                  <Area type="monotone" dataKey="memPct" stroke={memColor} strokeWidth={2} fill={`url(#${chartUid}-mem)`} isAnimationActive={false} />
                  <Area type="monotone" dataKey="diskPct" stroke={diskColor} strokeWidth={2} fill={`url(#${chartUid}-disk)`} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Network Throughput Chart */}
          <div
            style={{
              background: "var(--enb-card-bg)",
              border: "1px solid var(--md-sys-color-outline-variant)",
              borderRadius: "var(--md-sys-shape-card)",
              padding: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t("liveTraffic")}</span>
              <span className="enb-mono" style={{ fontSize: 12.5 }}>
                <span style={{ color: cpuColor, fontWeight: 600 }}>
                  ↑ {formatSpeedParts(status?.net_out).full}
                </span>
                {" · "}
                <span style={{ color: downColor, fontWeight: 600 }}>
                  ↓ {formatSpeedParts(status?.net_in).full}
                </span>
              </span>
            </div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activeResPoints}>
                  <defs>
                    <ChartGradient id={`${chartUid}-nout`} color={cpuColor} />
                    <ChartGradient id={`${chartUid}-nin`} color={downColor} />
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--enb-grid-stroke)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={40} tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }} />
                  <YAxis hide domain={[0, "auto"]} />
                  <Tooltip
                    isAnimationActive={false}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="enb-chart-tooltip enb-mono">
                          <div style={{ color: "var(--md-sys-color-on-surface-variant)" }}>{label}</div>
                          <div style={{ color: cpuColor, fontWeight: 600, marginTop: 3 }}>
                            ↑ {formatSpeedParts(Number(payload.find((x) => x.dataKey === "netOut")?.value || 0)).full}
                          </div>
                          <div style={{ color: downColor, fontWeight: 600 }}>
                            ↓ {formatSpeedParts(Number(payload.find((x) => x.dataKey === "netIn")?.value || 0)).full}
                          </div>
                        </div>
                      ) : null
                    }
                  />
                  <Area type="monotone" dataKey="netIn" stroke={downColor} strokeWidth={2} fill={`url(#${chartUid}-nin)`} isAnimationActive={false} />
                  <Area type="monotone" dataKey="netOut" stroke={cpuColor} strokeWidth={2} fill={`url(#${chartUid}-nout)`} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Load & Connections Chart */}
          <div
            style={{
              background: "var(--enb-card-bg)",
              border: "1px solid var(--md-sys-color-outline-variant)",
              borderRadius: "var(--md-sys-shape-card)",
              padding: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {t("load")} / {t("connections")}
              </span>
              <span className="enb-mono" style={{ fontSize: 12.5, color: "var(--md-sys-color-on-surface-variant)" }}>
                {Number(status?.load || 0).toFixed(2)} · {status?.connections ?? 0} conn
              </span>
            </div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeResPoints}>
                  <CartesianGrid vertical={false} stroke="var(--enb-grid-stroke)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={40} tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }} />
                  <YAxis yAxisId="left" axisLine={false} tickLine={false} width={36} tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" hide />
                  <Tooltip
                    isAnimationActive={false}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="enb-chart-tooltip enb-mono">
                          <div style={{ color: "var(--md-sys-color-on-surface-variant)" }}>{label}</div>
                          <div style={{ color: loadColor, fontWeight: 600, marginTop: 3 }}>
                            {t("load")}: {Number(payload.find((x) => x.dataKey === "load")?.value || 0).toFixed(2)}
                          </div>
                          <div style={{ color: chartSeriesColor(1, resolved), fontWeight: 600 }}>
                            {t("connections")}: {Number(payload.find((x) => x.dataKey === "connections")?.value || 0)}
                          </div>
                        </div>
                      ) : null
                    }
                  />
                  <Line yAxisId="left" type="monotone" dataKey="load" stroke={loadColor} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="connections" stroke={chartSeriesColor(1, resolved)} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Probe Filter Chips */}
          {pingDataset.tasks.length > 0 ? (
            <div className="enb-chip-group">
              <button
                type="button"
                className={`enb-filter-chip ${selectedTasks.length === 0 ? "is-selected" : ""}`}
                onClick={() => setSelectedTasks([])}
              >
                {selectedTasks.length === 0 ? <IconCheck size={13} /> : null}
                <span>{t("allProbeTasks")}</span>
              </button>
              {pingDataset.tasks.map((task, idx) => {
                const active = selectedTasks.includes(task.id);
                const color = chartSeriesColor(idx, resolved);
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={`enb-filter-chip ${active ? "is-selected" : ""}`}
                    onClick={() =>
                      setSelectedTasks((prev) =>
                        prev.includes(task.id)
                          ? prev.filter((x) => x !== task.id)
                          : [...prev, task.id],
                      )
                    }
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: color,
                      }}
                    />
                    <span>{task.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Route Summary KPIs */}
          {routeSummary ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 14,
              }}
            >
              {[
                [t("bestProbe"), routeSummary.bestName],
                [t("availability"), `${routeSummary.availability.toFixed(2)}%`],
                [
                  t("lowestDelay"),
                  routeSummary.minLatency !== null
                    ? `${routeSummary.minLatency.toFixed(2)} ms`
                    : "—",
                ],
                [
                  t("avgDelay"),
                  routeSummary.avgLatency !== null
                    ? `${routeSummary.avgLatency.toFixed(2)} ms`
                    : "—",
                ],
              ].map(([label, val]) => (
                <div
                  key={label}
                  style={{
                    padding: "16px 20px",
                    borderRadius: "var(--md-sys-shape-card)",
                    background: "var(--enb-card-bg)",
                    border: "1px solid var(--md-sys-color-outline-variant)",
                  }}
                >
                  <div style={{ fontSize: 12, color: "var(--md-sys-color-on-surface-variant)" }}>
                    {label}
                  </div>
                  <div
                    className="enb-mono"
                    style={{ marginTop: 6, fontSize: 20, fontWeight: 700 }}
                  >
                    {val}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Multi-Probe Latency Chart */}
          <div
            style={{
              background: "var(--enb-card-bg)",
              border: "1px solid var(--md-sys-color-outline-variant)",
              borderRadius: "var(--md-sys-shape-card)",
              padding: 22,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>
              {t("networkQuality")} (ms)
            </div>
            {pingDataset.tasks.length === 0 && !loadingChart ? (
              <div
                style={{
                  padding: "48px 16px",
                  textAlign: "center",
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("noPingTasks")}
              </div>
            ) : (
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartPingPoints}>
                    <CartesianGrid vertical={false} stroke="var(--enb-grid-stroke)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={44}
                      tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }}
                    />
                    <Tooltip
                      isAnimationActive={false}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="enb-chart-tooltip enb-mono">
                            <div
                              style={{
                                color: "var(--md-sys-color-on-surface-variant)",
                                marginBottom: 4,
                              }}
                            >
                              {label}
                            </div>
                            {payload.map((entry) => (
                              <div
                                key={String(entry.dataKey)}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 14,
                                  color: entry.color,
                                  fontWeight: 600,
                                }}
                              >
                                <span>{entry.name}</span>
                                <span>
                                  {entry.value !== null && entry.value !== undefined
                                    ? `${Number(entry.value).toFixed(2)} ms`
                                    : "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    {visiblePingTasks.map((task) => {
                      const idx = pingDataset.tasks.findIndex((x) => x.id === task.id);
                      const color = chartSeriesColor(idx >= 0 ? idx : 0, resolved);
                      return (
                        <Line
                          key={task.id}
                          type="monotone"
                          dataKey={`task_${task.id}`}
                          name={task.name}
                          stroke={color}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Probe Telemetry Table */}
          {pingDataset.tasks.length > 0 ? (
            <div className="enb-table-card">
              <table className="enb-table">
                <thead>
                  <tr>
                    <th>{t("probeDetails")}</th>
                    <th>{t("currentDelay")}</th>
                    <th>{t("avgDelay")}</th>
                    <th>{t("minMaxDelay")}</th>
                    <th>{t("p50p99")}</th>
                    <th>{t("packetLoss")}</th>
                    <th>{t("status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pingDataset.tasks.map((task, idx) => {
                    const degraded = task.loss >= 20 || (task.avg ?? 0) >= 240;
                    const elevated = !degraded && (task.loss >= 3 || (task.avg ?? 0) >= 110);
                    return (
                      <tr
                        key={task.id}
                        onClick={() =>
                          setSelectedTasks((prev) =>
                            prev.length === 1 && prev[0] === task.id ? [] : [task.id],
                          )
                        }
                      >
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              style={{
                                width: 9,
                                height: 9,
                                borderRadius: "50%",
                                background: chartSeriesColor(idx, resolved),
                              }}
                            />
                            <span style={{ fontWeight: 600 }}>{task.name}</span>
                            <span className="enb-pill enb-pill-neutral" style={{ height: 20, padding: "0 7px", fontSize: 10.5 }}>
                              {task.type}
                            </span>
                          </div>
                        </td>
                        <td className="enb-mono">
                          {task.latest !== null ? `${task.latest.toFixed(2)} ms` : "—"}
                        </td>
                        <td className="enb-mono">
                          {task.avg !== null ? `${task.avg.toFixed(2)} ms` : "—"}
                        </td>
                        <td className="enb-mono">
                          {task.min !== null && task.max !== null
                            ? `${task.min.toFixed(1)} / ${task.max.toFixed(1)} ms`
                            : "—"}
                        </td>
                        <td className="enb-mono">
                          {task.p50 !== null && task.p99 !== null
                            ? `${task.p50.toFixed(1)} / ${task.p99.toFixed(1)} ms`
                            : "—"}
                        </td>
                        <td className="enb-mono">{task.loss.toFixed(2)}%</td>
                        <td>
                          <span
                            className={`enb-pill ${
                              degraded
                                ? "enb-pill-error"
                                : elevated
                                  ? "enb-pill-warning"
                                  : "enb-pill-healthy"
                            }`}
                            style={{ height: 24 }}
                          >
                            <span className="enb-pill-dot" />
                            {degraded
                              ? t("degraded")
                              : elevated
                                ? t("elevated")
                                : t("healthy")}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
