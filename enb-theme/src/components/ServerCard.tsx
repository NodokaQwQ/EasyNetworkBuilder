import React from "react";
import { useNavigate } from "react-router-dom";
import { FlagIcon } from "@/components/FlagIcon";
import { IconArrowDown, IconArrowUp } from "@/components/Icons";
import { useI18n } from "@/i18n/locales";
import {
  clampPercent,
  computeCycleTrafficUsed,
  computeExpiryDaysLeft,
  computeResetDaysLeft,
  formatBytesParts,
  formatCurrencySymbol,
  formatSpeedParts,
  isLongTermDate,
  parseNodeTags,
  shortOsName,
} from "@/lib/format";
import type {
  LiveNodeStatus,
  PingSummaryStat,
  ProbeTick,
  ThemeNode,
  ThemeSettings,
} from "@/lib/rpc";
import { chartSeriesColor, useThemeMode } from "@/theme/tokens";

function synthesizeTicksFromStat(stat: PingSummaryStat): ProbeTick[] {
  const loss = Math.max(0, Number(stat.loss) || 0);
  const avg = Number(stat.avg) || Number(stat.latest) || 0;
  const badSlots = Math.min(10, Math.round((loss / 100) * 10));
  const warnBase = avg >= 180 || stat.tail >= 0.45;
  return Array.from({ length: 10 }, (_, idx) => {
    if (idx >= 10 - badSlots) {
      return { state: "bad", latency: null, loss: 1, time: null };
    }
    return {
      state: warnBase && idx % 3 === 1 ? "warn" : "good",
      latency: avg,
      loss: 0,
      time: null,
    };
  });
}

function latencyToneColor(ms: number, lossPct: number): string {
  if (ms < 0 || lossPct >= 25 || ms >= 240) return "var(--md-sys-color-error)";
  if (lossPct >= 5 || ms >= 110) return "var(--ops-color-warning)";
  return "var(--ops-color-healthy)";
}

function barColorByUsage(pct: number, baseColor: string): string {
  if (pct >= 90) return "var(--md-sys-color-error)";
  if (pct >= 75) return "var(--ops-color-warning)";
  return baseColor;
}

export const ServerCard: React.FC<{
  node: ThemeNode;
  status?: LiveNodeStatus;
  ticksByTask?: Record<string, ProbeTick[]>;
  themeSettings?: ThemeSettings;
}> = ({ node, status, ticksByTask, themeSettings }) => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { resolved } = useThemeMode();

  const online = Boolean(status?.online);
  const upColor = chartSeriesColor(0, resolved);
  const downColor = chartSeriesColor(3, resolved);
  const memColor = chartSeriesColor(4, resolved);
  const diskColor = chartSeriesColor(6, resolved);
  const loadColor = chartSeriesColor(2, resolved);

  const upSpeed = formatSpeedParts(online ? status?.net_out : 0);
  const downSpeed = formatSpeedParts(online ? status?.net_in : 0);
  const totalUp = formatBytesParts(status?.net_total_up ?? 0);
  const totalDown = formatBytesParts(status?.net_total_down ?? 0);

  const cpuPct = online ? Math.min(100, Math.max(0, Number(status?.cpu) || 0)) : 0;
  const memPct = online
    ? clampPercent(status?.ram, status?.ram_total || node.mem_total)
    : 0;
  const diskPct = online
    ? clampPercent(status?.disk, status?.disk_total || node.disk_total)
    : 0;
  const load1 = online ? Math.max(0, Number(status?.load) || 0) : 0;
  const cores = Math.max(1, Number(node.cpu_cores) || 1);
  const loadPct = Math.min(100, (load1 / cores) * 100);

  const pingEntries = Object.entries(status?.ping ?? {}).sort(([a], [b]) =>
    Number(a) - Number(b),
  );

  const quotaLimit = Math.max(
    0,
    Number(node.effective_traffic_limit || node.traffic_limit) || 0,
  );
  const quotaType = node.effective_traffic_type || node.traffic_limit_type || "sum";
  const cycleUsed = computeCycleTrafficUsed(
    quotaType,
    status?.net_total_up ?? 0,
    status?.net_total_down ?? 0,
  );
  const quotaPct = quotaLimit > 0 ? clampPercent(cycleUsed, quotaLimit) : 0;
  const resetDays = computeResetDaysLeft(
    node.traffic_reset_at,
    node.traffic_reset_day,
  );

  const longTerm = isLongTermDate(node.expired_at);
  const expiryDays = computeExpiryDaysLeft(node.expired_at);
  const price = Number(node.price) || 0;
  const showBilling = price !== 0 || !longTerm || Boolean(node.bandwidth && themeSettings?.ShowServerBandwidth);
  const currencySym = formatCurrencySymbol(
    node.currency,
    themeSettings?.DefaultBillingCurrency,
    themeSettings?.CnySymbolStyle,
  );

  const flagCode = node.region_override?.trim() || node.region;
  const osArch = [shortOsName(node.os), node.arch?.trim()].filter(Boolean).join(" · ");
  const tags = parseNodeTags(node.tags).slice(0, 2);

  return (
    <article
      className={`enb-server-card ${online ? "" : "is-offline"}`}
      onClick={() => navigate(`/server/${encodeURIComponent(node.uuid)}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/server/${encodeURIComponent(node.uuid)}`);
        }
      }}
    >
      {/* Header: Flag + Name + OS/Arch + Status Pill */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <FlagIcon region={flagCode} size={24} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 15.5,
                fontWeight: 700,
                lineHeight: 1.25,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={node.name}
            >
              {node.name}
            </div>
            <div
              style={{
                marginTop: 3,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                fontSize: 12,
                color: "var(--md-sys-color-on-surface-variant)",
              }}
            >
              <span>{osArch}</span>
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: "1px 7px",
                    borderRadius: 9999,
                    fontSize: 10.5,
                    fontWeight: 600,
                    background: "var(--md-sys-color-secondary-container)",
                    color: "var(--md-sys-color-on-secondary-container)",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <span
          className={`enb-pill ${online ? "enb-pill-healthy" : "enb-pill-error"}`}
          style={{ height: 24, padding: "0 9px", fontSize: 11.5 }}
        >
          <span className="enb-pill-dot" />
          {online ? t("online") : t("offline")}
        </span>
      </div>

      {/* Live Upload & Download Speeds */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
          paddingTop: 2,
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 11.5,
              fontWeight: 600,
              color: upColor,
            }}
          >
            <IconArrowUp size={12} />
            {t("upload")}
          </div>
          <div style={{ marginTop: 4 }}>
            <span className="enb-mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {upSpeed.value}
            </span>
            <span
              className="enb-mono"
              style={{
                fontSize: 11.5,
                marginLeft: 3,
                color: "var(--md-sys-color-on-surface-variant)",
              }}
            >
              {upSpeed.unit}
            </span>
          </div>
          <div
            className="enb-mono"
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: "var(--md-sys-color-on-surface-variant)",
            }}
          >
            {totalUp.full}
          </div>
        </div>

        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 11.5,
              fontWeight: 600,
              color: downColor,
            }}
          >
            <IconArrowDown size={12} />
            {t("download")}
          </div>
          <div style={{ marginTop: 4 }}>
            <span className="enb-mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {downSpeed.value}
            </span>
            <span
              className="enb-mono"
              style={{
                fontSize: 11.5,
                marginLeft: 3,
                color: "var(--md-sys-color-on-surface-variant)",
              }}
            >
              {downSpeed.unit}
            </span>
          </div>
          <div
            className="enb-mono"
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: "var(--md-sys-color-on-surface-variant)",
            }}
          >
            {totalDown.full}
          </div>
        </div>
      </div>

      {/* 2x2 Resource Bars: CPU / Memory / Disk / Load */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          columnGap: 14,
          rowGap: 11,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: 12,
              marginBottom: 5,
            }}
          >
            <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
              {t("cpu")}
            </span>
            <span className="enb-mono" style={{ fontWeight: 600 }}>
              {cpuPct.toFixed(1)}%
            </span>
          </div>
          <div className="enb-progress">
            <i
              style={{
                width: `${cpuPct}%`,
                background: barColorByUsage(cpuPct, upColor),
              }}
            />
          </div>
        </div>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: 12,
              marginBottom: 5,
            }}
          >
            <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
              {t("mem")}
            </span>
            <span className="enb-mono" style={{ fontWeight: 600 }}>
              {memPct.toFixed(1)}%
            </span>
          </div>
          <div className="enb-progress">
            <i
              style={{
                width: `${memPct}%`,
                background: barColorByUsage(memPct, memColor),
              }}
            />
          </div>
        </div>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: 12,
              marginBottom: 5,
            }}
          >
            <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
              {t("disk")}
            </span>
            <span className="enb-mono" style={{ fontWeight: 600 }}>
              {diskPct.toFixed(1)}%
            </span>
          </div>
          <div className="enb-progress">
            <i
              style={{
                width: `${diskPct}%`,
                background: barColorByUsage(diskPct, diskColor),
              }}
            />
          </div>
        </div>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: 12,
              marginBottom: 5,
            }}
          >
            <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
              {t("load")}
            </span>
            <span className="enb-mono" style={{ fontWeight: 600 }}>
              {load1.toFixed(2)}
            </span>
          </div>
          <div className="enb-progress">
            <i
              style={{
                width: `${loadPct}%`,
                background: barColorByUsage(loadPct, loadColor),
              }}
            />
          </div>
        </div>
      </div>

      {/* 1-Hour Network Quality Matrix */}
      {pingEntries.length > 0 ? (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 7,
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>{t("networkQuality")}</span>
            <span style={{ color: "var(--md-sys-color-on-surface-variant)", fontSize: 11.5 }}>
              {t("recent1Hour")}
            </span>
          </div>

          <div
            className="enb-probe-box"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/server/${encodeURIComponent(node.uuid)}?view=network`);
            }}
          >
            {pingEntries.slice(0, 4).map(([taskId, stat]) => {
              const displayMs =
                stat.latest >= 0 ? stat.latest : stat.avg > 0 ? stat.avg : -1;
              const tone = latencyToneColor(displayMs, stat.loss);
              const ticks =
                ticksByTask?.[taskId] ?? synthesizeTicksFromStat(stat);

              return (
                <div
                  key={taskId}
                  className="enb-probe-row"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(
                      `/server/${encodeURIComponent(node.uuid)}?view=network&ping_task=${encodeURIComponent(taskId)}`,
                    );
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        width: 3,
                        height: 24,
                        borderRadius: 99,
                        background: tone,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {stat.name}
                      </div>
                      <div className="enb-probe-ticks">
                        {ticks.map((tk, idx) => (
                          <span
                            key={idx}
                            className={`enb-probe-tick ${
                              tk.state === "good"
                                ? "is-good"
                                : tk.state === "warn"
                                  ? "is-warn"
                                  : tk.state === "bad"
                                    ? "is-bad"
                                    : ""
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="enb-mono" style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: tone }}>
                      {displayMs >= 0 ? displayMs.toFixed(2) : "—"}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        marginLeft: 2,
                        color: "var(--md-sys-color-on-surface-variant)",
                      }}
                    >
                      ms
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Monthly / Cycle Traffic Bar */}
      <div style={{ marginTop: "auto", paddingTop: 2 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            fontSize: 12.5,
            marginBottom: 6,
          }}
        >
          <div className="enb-mono">
            <strong style={{ fontWeight: 700 }}>{formatBytesParts(cycleUsed).full}</strong>
            <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
              {" / "}
              {quotaLimit > 0 ? formatBytesParts(quotaLimit).full : t("unlimitedTraffic")}
            </span>
          </div>
          {quotaLimit > 0 ? (
            <span
              className="enb-mono"
              style={{
                fontWeight: 700,
                fontSize: 12,
                color: barColorByUsage(quotaPct, "var(--md-sys-color-primary)"),
              }}
            >
              {quotaPct.toFixed(2)}%
            </span>
          ) : null}
        </div>

        <div className="enb-progress">
          <i
            style={{
              width: `${quotaLimit > 0 ? quotaPct : 100}%`,
              background:
                quotaLimit > 0
                  ? barColorByUsage(quotaPct, "var(--md-sys-color-primary)")
                  : "var(--md-sys-color-secondary-container)",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 6,
            fontSize: 11.5,
            color: "var(--md-sys-color-on-surface-variant)",
          }}
        >
          <span>{t("usedTraffic")}</span>
          {resetDays !== null ? (
            <span
              style={{
                color:
                  resetDays <= 7
                    ? "var(--ops-color-warning)"
                    : "var(--md-sys-color-on-surface-variant)",
                fontWeight: resetDays <= 7 ? 600 : 400,
              }}
            >
              {resetDays === 0 ? t("resetToday") : t("resetInDays", { days: resetDays })}
            </span>
          ) : null}
        </div>
      </div>

      {/* Billing Expiry / Bandwidth Footer */}
      {showBilling ? (
        <div
          style={{
            paddingTop: 10,
            borderTop: "1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 60%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 11.5,
            color: "var(--md-sys-color-on-surface-variant)",
          }}
        >
          <span className="enb-mono">
            {price < 0
              ? t("free")
              : price > 0
                ? `${currencySym}${price.toFixed(2)}`
                : node.public_remark || ""}
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {themeSettings?.ShowServerBandwidth && node.bandwidth ? (
              <span className="enb-mono">{node.bandwidth}</span>
            ) : null}
            {!longTerm && expiryDays !== null ? (
              <span
                style={{
                  fontWeight: expiryDays <= 14 ? 600 : 500,
                  color:
                    expiryDays <= 0
                      ? "var(--md-sys-color-error)"
                      : expiryDays <= 14
                        ? "var(--ops-color-warning)"
                        : "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {expiryDays <= 0
                  ? t("expired")
                  : t("remainingDays", { days: expiryDays })}
              </span>
            ) : (
              <span>{t("longTerm")}</span>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
};
