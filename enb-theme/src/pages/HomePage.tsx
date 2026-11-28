import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlagIcon } from "@/components/FlagIcon";
import {
  IconCheck,
  IconGrid,
  IconList,
  IconSearch,
  IconSort,
} from "@/components/Icons";
import { OverviewHero } from "@/components/OverviewHero";
import { OverviewTrendsRow } from "@/components/OverviewTrendsRow";
import { ServerCard } from "@/components/ServerCard";
import { useI18n, type MessageKey } from "@/i18n/locales";
import { useDashboardData } from "@/lib/DataContext";
import {
  clampPercent,
  computeCycleTrafficUsed,
  computeExpiryDaysLeft,
  formatBytesParts,
  formatSpeedParts,
  isLongTermDate,
  shortOsName,
} from "@/lib/format";

type SortKey =
  | "default"
  | "name"
  | "cpu"
  | "mem"
  | "upload"
  | "download"
  | "traffic"
  | "expiry";

type ViewMode = "grid" | "table";

const SORT_OPTIONS: Array<[SortKey, MessageKey]> = [
  ["default", "sortDefault"],
  ["name", "sortName"],
  ["cpu", "sortCpu"],
  ["mem", "sortMem"],
  ["upload", "sortUpload"],
  ["download", "sortDownload"],
  ["traffic", "sortTraffic"],
  ["expiry", "sortExpiry"],
];

export const HomePage: React.FC = () => {
  const { loading, nodes, statuses, probeTicks, publicSettings } =
    useDashboardData();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [selectedGroup, setSelectedGroup] = useState<string>("__all__");
  const [query, setQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("default");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortOpen, setSortOpen] = useState<boolean>(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      const g = n.group?.trim();
      if (g) set.add(g);
    }
    return Array.from(set);
  }, [nodes]);

  useEffect(() => {
    if (selectedGroup !== "__all__" && !groups.includes(selectedGroup)) {
      setSelectedGroup("__all__");
    }
  }, [groups, selectedGroup]);

  const filteredNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = nodes.filter((node) => {
      if (selectedGroup !== "__all__" && (node.group?.trim() || "") !== selectedGroup) {
        return false;
      }
      if (!q) return true;
      const hay = [
        node.name,
        node.os,
        node.arch,
        node.region,
        node.region_override,
        node.group,
        node.tags,
        node.public_remark,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    if (sortBy === "default") return list;

    return [...list].sort((a, b) => {
      const sa = statuses[a.uuid];
      const sb = statuses[b.uuid];
      switch (sortBy) {
        case "name":
          return (a.name || "").localeCompare(b.name || "");
        case "cpu":
          return (Number(sb?.cpu) || 0) - (Number(sa?.cpu) || 0);
        case "mem": {
          const ma = clampPercent(sa?.ram, sa?.ram_total || a.mem_total);
          const mb = clampPercent(sb?.ram, sb?.ram_total || b.mem_total);
          return mb - ma;
        }
        case "upload":
          return (Number(sb?.net_out) || 0) - (Number(sa?.net_out) || 0);
        case "download":
          return (Number(sb?.net_in) || 0) - (Number(sa?.net_in) || 0);
        case "traffic": {
          const la = Number(a.effective_traffic_limit || a.traffic_limit) || 0;
          const lb = Number(b.effective_traffic_limit || b.traffic_limit) || 0;
          const ua = computeCycleTrafficUsed(
            a.effective_traffic_type || a.traffic_limit_type,
            sa?.net_total_up ?? 0,
            sa?.net_total_down ?? 0,
          );
          const ub = computeCycleTrafficUsed(
            b.effective_traffic_type || b.traffic_limit_type,
            sb?.net_total_up ?? 0,
            sb?.net_total_down ?? 0,
          );
          const pa = la > 0 ? ua / la : -1;
          const pb = lb > 0 ? ub / lb : -1;
          return pb - pa;
        }
        case "expiry": {
          const da = computeExpiryDaysLeft(a.expired_at) ?? 999999;
          const db = computeExpiryDaysLeft(b.expired_at) ?? 999999;
          return da - db;
        }
        default:
          return 0;
      }
    });
  }, [nodes, query, selectedGroup, sortBy, statuses]);

  const activeSortLabel =
    SORT_OPTIONS.find(([key]) => key === sortBy)?.[1] ?? "sortDefault";

  return (
    <>
      <OverviewHero />

      <OverviewTrendsRow />

      {/* Toolbar: Group Chips + Search + Sort + View Mode */}
      <section className="enb-toolbar">
        <div className="enb-toolbar-left">
          <h2 className="enb-section-heading">
            <span>{t("allServers")}</span>
            <span className="enb-section-count enb-mono">
              {t("serverUnit", { count: filteredNodes.length })}
            </span>
          </h2>

          <div className="enb-chip-group" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={selectedGroup === "__all__"}
              className={`enb-filter-chip ${selectedGroup === "__all__" ? "is-selected" : ""}`}
              onClick={() => setSelectedGroup("__all__")}
            >
              {selectedGroup === "__all__" ? <IconCheck size={13} /> : null}
              <span>{t("allGroups")}</span>
            </button>
            {groups.map((group) => {
              const active = selectedGroup === group;
              return (
                <button
                  key={group}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`enb-filter-chip ${active ? "is-selected" : ""}`}
                  onClick={() => setSelectedGroup(group)}
                >
                  {active ? <IconCheck size={13} /> : null}
                  <span>{group}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="enb-toolbar-right">
          <label className="enb-search">
            <IconSearch size={15} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
            />
          </label>

          {/* Sort Dropdown */}
          <div className="enb-menu-wrap" ref={sortRef}>
            <button
              type="button"
              className="enb-btn enb-btn-outlined"
              onClick={() => setSortOpen((v) => !v)}
            >
              <IconSort size={14} />
              <span>{t(activeSortLabel)}</span>
            </button>
            {sortOpen ? (
              <div className="enb-menu" role="menu">
                {SORT_OPTIONS.map(([key, labelKey]) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    className={`enb-menu-item ${sortBy === key ? "is-active" : ""}`}
                    onClick={() => {
                      setSortBy(key);
                      setSortOpen(false);
                    }}
                  >
                    <span>{t(labelKey)}</span>
                    {sortBy === key ? <IconCheck /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Grid / Table Segmented Switcher */}
          <div className="enb-segmented" role="group">
            <button
              type="button"
              className={viewMode === "grid" ? "is-active" : ""}
              onClick={() => setViewMode("grid")}
              title={t("viewGrid")}
            >
              <IconGrid size={14} />
              <span>{t("viewGrid")}</span>
            </button>
            <button
              type="button"
              className={viewMode === "table" ? "is-active" : ""}
              onClick={() => setViewMode("table")}
              title={t("viewTable")}
            >
              <IconList size={14} />
              <span>{t("viewTable")}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Server List / Grid */}
      {loading && nodes.length === 0 ? (
        <div
          style={{
            padding: "56px 24px",
            textAlign: "center",
            borderRadius: "var(--md-sys-shape-card)",
            background: "var(--enb-card-bg)",
            border: "1px solid var(--md-sys-color-outline-variant)",
            color: "var(--md-sys-color-on-surface-variant)",
          }}
        >
          {t("loading")}
        </div>
      ) : filteredNodes.length === 0 ? (
        <div
          style={{
            padding: "56px 24px",
            textAlign: "center",
            borderRadius: "var(--md-sys-shape-card)",
            background: "var(--enb-card-bg)",
            border: "1px solid var(--md-sys-color-outline-variant)",
          }}
        >
          <p style={{ margin: "0 0 14px", color: "var(--md-sys-color-on-surface-variant)" }}>
            {t("noMatchingServers")}
          </p>
          {(query || selectedGroup !== "__all__") ? (
            <button
              type="button"
              className="enb-btn enb-btn-tonal"
              onClick={() => {
                setQuery("");
                setSelectedGroup("__all__");
              }}
            >
              {t("clearFilters")}
            </button>
          ) : null}
        </div>
      ) : viewMode === "grid" ? (
        <section className="enb-server-grid">
          {filteredNodes.map((node) => (
            <ServerCard
              key={node.uuid}
              node={node}
              status={statuses[node.uuid]}
              ticksByTask={probeTicks[node.uuid]}
              themeSettings={publicSettings.theme_settings}
            />
          ))}
        </section>
      ) : (
        <section className="enb-table-card">
          <table className="enb-table">
            <thead>
              <tr>
                <th>{t("allServers")}</th>
                <th>{t("status")}</th>
                <th>{t("upload")} / {t("download")}</th>
                <th>{t("cpu")}</th>
                <th>{t("mem")}</th>
                <th>{t("disk")}</th>
                <th>{t("usedTraffic")}</th>
                <th>{t("cycleBilling")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredNodes.map((node) => {
                const st = statuses[node.uuid];
                const online = Boolean(st?.online);
                const cpu = online ? Math.min(100, Math.max(0, Number(st?.cpu) || 0)) : 0;
                const mem = online ? clampPercent(st?.ram, st?.ram_total || node.mem_total) : 0;
                const disk = online ? clampPercent(st?.disk, st?.disk_total || node.disk_total) : 0;
                const limit = Math.max(
                  0,
                  Number(node.effective_traffic_limit || node.traffic_limit) || 0,
                );
                const used = computeCycleTrafficUsed(
                  node.effective_traffic_type || node.traffic_limit_type,
                  st?.net_total_up ?? 0,
                  st?.net_total_down ?? 0,
                );
                const expDays = computeExpiryDaysLeft(node.expired_at);
                const longTerm = isLongTermDate(node.expired_at);

                return (
                  <tr
                    key={node.uuid}
                    onClick={() => navigate(`/server/${encodeURIComponent(node.uuid)}`)}
                  >
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <FlagIcon region={node.region_override || node.region} size={22} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{node.name}</div>
                          <div
                            style={{
                              fontSize: 11.5,
                              color: "var(--md-sys-color-on-surface-variant)",
                            }}
                          >
                            {[shortOsName(node.os), node.arch].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`enb-pill ${online ? "enb-pill-healthy" : "enb-pill-error"}`}
                        style={{ height: 24, padding: "0 9px", fontSize: 11.5 }}
                      >
                        <span className="enb-pill-dot" />
                        {online ? t("online") : t("offline")}
                      </span>
                    </td>
                    <td className="enb-mono">
                      <div>↑ {formatSpeedParts(online ? st?.net_out : 0).full}</div>
                      <div style={{ color: "var(--md-sys-color-on-surface-variant)", fontSize: 12 }}>
                        ↓ {formatSpeedParts(online ? st?.net_in : 0).full}
                      </div>
                    </td>
                    <td className="enb-mono">{cpu.toFixed(1)}%</td>
                    <td className="enb-mono">{mem.toFixed(1)}%</td>
                    <td className="enb-mono">{disk.toFixed(1)}%</td>
                    <td className="enb-mono">
                      {formatBytesParts(used).full}
                      <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
                        {" / "}
                        {limit > 0 ? formatBytesParts(limit).full : t("unlimitedTraffic")}
                      </span>
                    </td>
                    <td className="enb-mono">
                      {longTerm || expDays === null
                        ? t("longTerm")
                        : expDays <= 0
                          ? t("expired")
                          : t("remainingDays", { days: expDays })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
};
