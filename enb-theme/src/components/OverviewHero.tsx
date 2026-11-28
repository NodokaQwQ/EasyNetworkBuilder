import React, { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartGradient } from "@/components/ChartGradient";
import { IconArrowDown, IconArrowUp } from "@/components/Icons";
import { useI18n } from "@/i18n/locales";
import { useDashboardData } from "@/lib/DataContext";
import {
  clampPercent,
  formatBytesParts,
  formatSpeedParts,
  greetingKeyByHour,
} from "@/lib/format";
import { chartSeriesColor, useThemeMode } from "@/theme/tokens";

export const OverviewHero: React.FC = () => {
  const { nodes, statuses, me, trafficHistory } = useDashboardData();
  const { t } = useI18n();
  const { resolved } = useThemeMode();
  const chartUid = useId().replace(/:/g, "");

  const uploadColor = chartSeriesColor(0, resolved); // Primary Indigo (#5845FF / #9D92FF)
  const downloadColor = chartSeriesColor(3, resolved); // Emerald (#10B981 / #73F2BE)
  const memColor = chartSeriesColor(4, resolved); // Violet (#8B5CF6 / #C4B5FD)
  const diskColor = chartSeriesColor(6, resolved); // Tertiary Fuchsia (#D946EF / #F5A6FF)

  const summary = useMemo(() => {
    let onlineCount = 0;
    let totalCores = 0;
    let weightedCpuSum = 0;
    let cpuWeight = 0;
    let memUsed = 0;
    let memTotal = 0;
    let diskUsed = 0;
    let diskTotal = 0;
    let speedUp = 0;
    let speedDown = 0;
    let totalUp = 0;
    let totalDown = 0;
    let tcpConn = 0;
    let udpConn = 0;

    for (const node of nodes) {
      const st = statuses[node.uuid];
      const cores = Math.max(0, Number(node.cpu_cores) || 0);
      totalCores += cores;

      const nodeMemTotal = Math.max(0, Number(st?.ram_total || node.mem_total) || 0);
      const nodeDiskTotal = Math.max(0, Number(st?.disk_total || node.disk_total) || 0);
      memTotal += nodeMemTotal;
      diskTotal += nodeDiskTotal;

      if (st?.online) {
        onlineCount += 1;
        const w = cores > 0 ? cores : 1;
        weightedCpuSum += Math.max(0, Number(st.cpu) || 0) * w;
        cpuWeight += w;

        memUsed += Math.max(0, Number(st.ram) || 0);
        diskUsed += Math.max(0, Number(st.disk) || 0);
        speedUp += Math.max(0, Number(st.net_out) || 0);
        speedDown += Math.max(0, Number(st.net_in) || 0);
      }
      if (st) {
        totalUp += Math.max(0, Number(st.net_total_up) || 0);
        totalDown += Math.max(0, Number(st.net_total_down) || 0);
        const totalConn = Math.max(0, Number(st.connections) || 0);
        const udp = Math.max(0, Number(st.connections_udp) || 0);
        udpConn += st.online ? udp : 0;
        tcpConn += st.online ? Math.max(0, totalConn - udp) : 0;
      }
    }

    const totalNodes = nodes.length;
    const offlineCount = Math.max(0, totalNodes - onlineCount);
    const onlineRate = totalNodes > 0 ? Math.round((onlineCount / totalNodes) * 100) : 0;
    const avgCpu = cpuWeight > 0 ? weightedCpuSum / cpuWeight : 0;
    const memPct = clampPercent(memUsed, memTotal);
    const diskPct = clampPercent(diskUsed, diskTotal);

    return {
      totalNodes,
      onlineCount,
      offlineCount,
      onlineRate,
      totalCores,
      avgCpu,
      memUsed,
      memTotal,
      memPct,
      diskUsed,
      diskTotal,
      diskPct,
      speedUp,
      speedDown,
      totalSpeed: speedUp + speedDown,
      totalUp,
      totalDown,
      totalTraffic: totalUp + totalDown,
      tcpConn,
      udpConn,
      allConn: tcpConn + udpConn,
    };
  }, [nodes, statuses]);

  const upSpeedFmt = formatSpeedParts(summary.speedUp);
  const downSpeedFmt = formatSpeedParts(summary.speedDown);
  const totalSpeedFmt = formatSpeedParts(summary.totalSpeed);
  const totalTrafficFmt = formatBytesParts(summary.totalTraffic);
  const totalUpFmt = formatBytesParts(summary.totalUp);
  const totalDownFmt = formatBytesParts(summary.totalDown);
  const memUsedFmt = formatBytesParts(summary.memUsed);
  const memTotalFmt = formatBytesParts(summary.memTotal);
  const diskUsedFmt = formatBytesParts(summary.diskUsed);
  const diskTotalFmt = formatBytesParts(summary.diskTotal);

  const statusPillClass =
    summary.totalNodes === 0 || summary.onlineCount === summary.totalNodes
      ? "enb-pill enb-pill-healthy"
      : summary.onlineCount === 0
        ? "enb-pill enb-pill-error"
        : "enb-pill enb-pill-warning";

  const statusPillLabel =
    summary.totalNodes === 0 || summary.onlineCount === summary.totalNodes
      ? t("allOnline")
      : summary.onlineCount === 0
        ? t("allOffline")
        : t("partialOffline");

  return (
    <section className="enb-hero-card">
      <div className="enb-hero-header">
        <div className="enb-hero-title-group">
          <h1 className="enb-hero-title">{t("serverOverview")}</h1>
          {me.logged_in && me.username ? (
            <>
              <span className="enb-brand-divider" aria-hidden="true" />
              <span className="enb-hero-greeting">
                {t(greetingKeyByHour())}，<strong>{me.username}</strong>
              </span>
            </>
          ) : null}
        </div>

        <div className="enb-hero-stats-bar">
          <span className={statusPillClass}>
            <span className="enb-pill-dot" />
            {statusPillLabel}
          </span>
          <span>
            {t("online")}
            <b>{summary.onlineCount}</b>
          </span>
          <span>
            {t("offline")}
            <b>{summary.offlineCount}</b>
          </span>
          <span>
            {t("onlineRate")}
            <b>{summary.onlineRate}%</b>
          </span>
        </div>
      </div>

      <div className="enb-hero-body">
        {/* Left Pane: Live 1-Minute Throughput */}
        <div className="enb-hero-traffic-pane">
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--md-sys-color-on-surface-variant)",
                  }}
                >
                  {t("liveTraffic")}
                </span>
                <span className="enb-pill enb-pill-primary enb-mono" style={{ height: 24 }}>
                  {totalSpeedFmt.full}
                </span>
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("last1Min")}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                gap: 28,
                marginBottom: 14,
              }}
            >
              <div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    color: uploadColor,
                    marginRight: 8,
                  }}
                >
                  <IconArrowUp size={13} />
                  {t("upload")}
                </div>
                <span
                  className="enb-mono"
                  style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}
                >
                  {upSpeedFmt.value}
                </span>
                <span
                  className="enb-mono"
                  style={{
                    fontSize: 12.5,
                    marginLeft: 4,
                    color: "var(--md-sys-color-on-surface-variant)",
                  }}
                >
                  {upSpeedFmt.unit}
                </span>
              </div>

              <div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    color: downloadColor,
                    marginRight: 8,
                  }}
                >
                  <IconArrowDown size={13} />
                  {t("download")}
                </div>
                <span
                  className="enb-mono"
                  style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}
                >
                  {downSpeedFmt.value}
                </span>
                <span
                  className="enb-mono"
                  style={{
                    fontSize: 12.5,
                    marginLeft: 4,
                    color: "var(--md-sys-color-on-surface-variant)",
                  }}
                >
                  {downSpeedFmt.unit}
                </span>
              </div>
            </div>
          </div>

          <div style={{ width: "100%", height: 112 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trafficHistory} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <ChartGradient id={`${chartUid}-up`} color={uploadColor} topOpacity={0.32} />
                  <ChartGradient id={`${chartUid}-down`} color={downloadColor} topOpacity={0.28} />
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--enb-grid-stroke)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={48}
                  tick={{ fill: "var(--md-sys-color-on-surface-variant)", fontSize: 11 }}
                />
                <YAxis hide domain={[0, "auto"]} />
                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const up = Number(payload.find((p) => p.dataKey === "up")?.value || 0);
                    const down = Number(payload.find((p) => p.dataKey === "down")?.value || 0);
                    return (
                      <div className="enb-chart-tooltip">
                        <div
                          className="enb-mono"
                          style={{
                            color: "var(--md-sys-color-on-surface-variant)",
                            marginBottom: 4,
                          }}
                        >
                          {label}
                        </div>
                        <div className="enb-mono" style={{ color: uploadColor, fontWeight: 600 }}>
                          ↑ {formatSpeedParts(up).full}
                        </div>
                        <div className="enb-mono" style={{ color: downloadColor, fontWeight: 600 }}>
                          ↓ {formatSpeedParts(down).full}
                        </div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="down"
                  stroke={downloadColor}
                  strokeWidth={2}
                  fill={`url(#${chartUid}-down)`}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="up"
                  stroke={uploadColor}
                  strokeWidth={2}
                  fill={`url(#${chartUid}-up)`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Pane: Connections, Cumulative Traffic, CPU / Mem / Disk */}
        <div className="enb-hero-metrics-pane">
          <div className="enb-hero-top-metrics">
            <div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("connections")}
              </div>
              <div style={{ marginTop: 6 }}>
                <span className="enb-mono" style={{ fontSize: 26, fontWeight: 700 }}>
                  {summary.allConn}
                </span>
                {t("connUnit") ? (
                  <span
                    style={{
                      fontSize: 12.5,
                      marginLeft: 4,
                      color: "var(--md-sys-color-on-surface-variant)",
                    }}
                  >
                    {t("connUnit")}
                  </span>
                ) : null}
              </div>
              <div
                className="enb-mono"
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                TCP {summary.tcpConn} · UDP {summary.udpConn}
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("cumulativeTraffic")}
              </div>
              <div style={{ marginTop: 6 }}>
                <span className="enb-mono" style={{ fontSize: 26, fontWeight: 700 }}>
                  {totalTrafficFmt.value}
                </span>
                <span
                  className="enb-mono"
                  style={{
                    fontSize: 12.5,
                    marginLeft: 4,
                    color: "var(--md-sys-color-on-surface-variant)",
                  }}
                >
                  {totalTrafficFmt.unit}
                </span>
              </div>
              <div
                className="enb-mono"
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("upload")} {totalUpFmt.full} · {t("download")} {totalDownFmt.full}
              </div>
            </div>
          </div>

          <div className="enb-hero-bottom-metrics">
            {/* CPU */}
            <div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("cpuUsage")}
              </div>
              <div style={{ marginTop: 6 }}>
                <span className="enb-mono" style={{ fontSize: 21, fontWeight: 700 }}>
                  {summary.avgCpu.toFixed(1)}
                </span>
                <span
                  className="enb-mono"
                  style={{
                    fontSize: 12,
                    marginLeft: 3,
                    color: "var(--md-sys-color-on-surface-variant)",
                  }}
                >
                  %
                </span>
              </div>
              <div
                style={{
                  margin: "6px 0 8px",
                  fontSize: 11.5,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("totalCores", { count: summary.totalCores })}
              </div>
              <div className="enb-progress">
                <i
                  style={{
                    width: `${Math.min(100, summary.avgCpu)}%`,
                    background: uploadColor,
                  }}
                />
              </div>
            </div>

            {/* Memory */}
            <div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("memUsage")}
              </div>
              <div style={{ marginTop: 6 }}>
                <span className="enb-mono" style={{ fontSize: 21, fontWeight: 700 }}>
                  {memUsedFmt.value}
                </span>
                <span
                  className="enb-mono"
                  style={{
                    fontSize: 12,
                    marginLeft: 3,
                    color: "var(--md-sys-color-on-surface-variant)",
                  }}
                >
                  {memUsedFmt.unit}
                </span>
              </div>
              <div
                className="enb-mono"
                style={{
                  margin: "6px 0 8px",
                  fontSize: 11.5,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("totalCap", { total: memTotalFmt.full })} · {summary.memPct.toFixed(1)}%
              </div>
              <div className="enb-progress">
                <i style={{ width: `${summary.memPct}%`, background: memColor }} />
              </div>
            </div>

            {/* Disk */}
            <div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("diskUsage")}
              </div>
              <div style={{ marginTop: 6 }}>
                <span className="enb-mono" style={{ fontSize: 21, fontWeight: 700 }}>
                  {diskUsedFmt.value}
                </span>
                <span
                  className="enb-mono"
                  style={{
                    fontSize: 12,
                    marginLeft: 3,
                    color: "var(--md-sys-color-on-surface-variant)",
                  }}
                >
                  {diskUsedFmt.unit}
                </span>
              </div>
              <div
                className="enb-mono"
                style={{
                  margin: "6px 0 8px",
                  fontSize: 11.5,
                  color: "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {t("totalCap", { total: diskTotalFmt.full })} · {summary.diskPct.toFixed(1)}%
              </div>
              <div className="enb-progress">
                <i style={{ width: `${summary.diskPct}%`, background: diskColor }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
