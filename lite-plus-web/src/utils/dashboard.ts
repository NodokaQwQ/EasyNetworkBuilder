import { formatBytes } from "./unitHelper.ts";

export interface DashboardOfflineNode {
  uuid: string;
  name: string;
  region: string;
  last_seen: string | null;
}

export interface DashboardTrafficServerMeta {
  uuid: string;
  name: string;
}

export interface DashboardTrafficDay {
  day: string;
  up: number;
  down: number;
  billable: number;
  by_server?: Record<string, number>;
}

export interface DashboardTrafficHour {
  hour: string;
  up: number;
  down: number;
}

export interface DashboardTrafficRankItem {
  uuid: string;
  name: string;
  ipv4?: string;
  ipv6?: string;
  group?: string;
  tags?: string;
  up: number;
  down: number;
  billable: number;
  detail_url?: string;
}

export interface DashboardDatabaseFiles {
  database: number;
  wal: number;
  shm: number;
}

export interface DashboardDatabaseStatus {
  driver: string;
  location: string;
  size: number | null;
  files?: DashboardDatabaseFiles;
  error?: string;
}

export interface DashboardReturnRouteEvent {
  id: number;
  task_name: string;
  node_name: string;
  expected_line: string;
  from_line: string;
  to_line: string;
  kind: string;
  occurred_at: string;
}

export interface DashboardReturnRouteStatus {
  tasks: number;
  active: number;
  healthy: number;
  switched: number;
  abnormal: number;
  suspected_blocked?: number;
  recent_events: number;
  latest_event?: DashboardReturnRouteEvent;
  error?: string;
}

export interface DashboardAlertLatest {
  title: string;
  node_name?: string;
  node_uuid?: string;
  task_id?: number;
  task_name?: string;
  occurred_at?: string;
  due_at?: string;
}

export type DashboardAlertKind =
  | "offline"
  | "resource"
  | "latency_loss"
  | "traffic"
  | "return_route"
  | "billing";

export interface DashboardAlertAffectedItem extends DashboardAlertLatest {
  kind: DashboardAlertKind;
}

export interface DashboardAlertItemsResponse {
  kind: DashboardAlertKind;
  items: DashboardAlertAffectedItem[];
  generated_at: string;
}

export interface DashboardAlertSummary {
  current: number;
  affected_nodes: number;
  recovered_today: number;
  latest_alert?: DashboardAlertLatest;
  error?: string;
}

export interface DashboardAlerts {
  resource: DashboardAlertSummary;
  offline: DashboardAlertSummary;
  latency_loss: DashboardAlertSummary;
  traffic: DashboardAlertSummary;
  return_route: DashboardAlertSummary;
  billing: DashboardAlertSummary;
}

export interface DashboardLatencyPoint {
  time: string;
  average: number;
  loss_rate?: number;
}

export interface DashboardLatencySummary {
  average: number;
  average_loss?: number;
  targets: number;
  points: DashboardLatencyPoint[];
  ranking: DashboardLatencyRankItem[];
  jitter_ranking: DashboardLatencyJitterRankItem[];
  jitter_error?: string;
  error?: string;
}

export interface DashboardLatencyRankItem {
  uuid: string;
  name: string;
  average: number;
  task_id?: number;
  task_name?: string;
  detail_url?: string;
}

export interface DashboardLatencyJitterRankItem {
  uuid: string;
  name: string;
  previous: number;
  current: number;
  delta: number;
  task_id?: number;
  task_name?: string;
  detail_url?: string;
}

export interface DashboardPacketLossRankItem {
  uuid: string;
  name: string;
  task_id: number;
  task_name: string;
  loss_rate: number;
  lost: number;
  total: number;
  valid: number;
  detail_url?: string;
}

export interface DashboardResourceRankItem {
  uuid: string;
  name: string;
  cpu: number;
  memory: number;
  disk: number;
  detail_url?: string;
}

export interface DashboardResourceSummary {
  cpu: DashboardResourceRankItem[];
  memory: DashboardResourceRankItem[];
  disk: DashboardResourceRankItem[];
}

export interface DashboardData {
  servers: {
    total: number;
    online: number;
    offline: number;
    offline_nodes: DashboardOfflineNode[];
  };
  resources: DashboardResourceSummary;
  database: {
    type: string;
    size: number;
    main: DashboardDatabaseStatus;
    monitoring: DashboardDatabaseStatus;
    local_total: number | null;
  };
  storage: {
    database_files: number;
    wal: number;
    shm: number;
    retention_days: number;
    last_compacted_at: string | null;
  };
  return_route: DashboardReturnRouteStatus;
  alerts: DashboardAlerts;
  generated_at: string;
}

export interface DashboardChartsData {
  traffic: {
    today_up: number;
    today_down: number;
    today_billable: number;
    period_up?: number;
    period_down?: number;
    period_billable?: number;
    period_days?: number;
    daily_average_up?: number;
    daily_average_down?: number;
    daily_average_billable?: number;
    hourly: DashboardTrafficHour[];
    daily: DashboardTrafficDay[];
    servers?: DashboardTrafficServerMeta[];
    ranking: DashboardTrafficRankItem[];
    history_ready: boolean;
    error?: string;
  };
  latency: DashboardLatencySummary;
  packet_loss: {
    window_minutes: number;
    ranking: DashboardPacketLossRankItem[];
    error?: string;
  };
  generated_at: string;
}

export interface DashboardTrafficDayResponse {
  day: string;
  items: DashboardTrafficRankItem[];
  generated_at: string;
}

export type DashboardTrafficGranularity = "1h" | "6h" | "12h" | "1d" | "7d";
export type DashboardTrafficDirection = "total" | "up" | "down";

export interface DashboardTrafficSeriesUsage {
  up: number;
  down: number;
  total: number;
}

export interface DashboardTrafficSeriesBucket {
  start: string;
  end: string;
  label: string;
  up: number;
  down: number;
  total: number;
  by_server?: Record<string, DashboardTrafficSeriesUsage>;
}

export interface DashboardTrafficSeriesResponse {
  granularity: DashboardTrafficGranularity;
  servers: DashboardTrafficServerMeta[];
  buckets: DashboardTrafficSeriesBucket[];
  generated_at: string;
}

export const DASHBOARD_TOTAL_SERIES_KEY = "__total__";

export function buildTrafficSeriesChartRows(
  response: DashboardTrafficSeriesResponse | null | undefined,
  direction: DashboardTrafficDirection,
  locale: string,
): {
  rows: Array<Record<string, number | string>>;
  totalsByServer: Record<string, number>;
  peakValue: number;
} {
  if (!response || !Array.isArray(response.buckets) || response.buckets.length === 0) {
    return { rows: [], totalsByServer: {}, peakValue: 0 };
  }
  const servers = response.servers ?? [];
  const totalsByServer: Record<string, number> = { [DASHBOARD_TOTAL_SERIES_KEY]: 0 };
  for (const s of servers) {
    totalsByServer[s.uuid] = 0;
  }

  const pick = (u?: DashboardTrafficSeriesUsage): number => {
    if (!u) return 0;
    if (direction === "up") return Math.max(0, Number(u.up) || 0);
    if (direction === "down") return Math.max(0, Number(u.down) || 0);
    return Math.max(0, Number(u.total ?? (Number(u.up || 0) + Number(u.down || 0))) || 0);
  };

  let peakValue = 0;
  const rows = response.buckets.map((bucket) => {
    const label =
      response.granularity === "1d"
        ? shortDashboardDay(bucket.label, locale)
        : bucket.label;
    const row: Record<string, number | string> = { label };
    let bucketSum = 0;
    for (const s of servers) {
      const val = pick(bucket.by_server?.[s.uuid]);
      row[`srv_${s.uuid}`] = val;
      totalsByServer[s.uuid] = (totalsByServer[s.uuid] ?? 0) + val;
      bucketSum += val;
      if (val > peakValue) peakValue = val;
    }
    const bucketTotal =
      servers.length > 0
        ? bucketSum
        : direction === "up"
          ? bucket.up
          : direction === "down"
            ? bucket.down
            : bucket.total;
    row[DASHBOARD_TOTAL_SERIES_KEY] = bucketTotal;
    totalsByServer[DASHBOARD_TOTAL_SERIES_KEY] += bucketTotal;
    if (bucketTotal > peakValue) peakValue = bucketTotal;
    return row;
  });

  return { rows, totalsByServer, peakValue };
}

export interface StackedDailyBillingRow {
  day: string;
  label: string;
  billable: number;
  topServerKey: string;
  [serverField: string]: number | string;
}

export function buildStackedDailyBillingChart(
  daily: readonly (DashboardTrafficDay & { label?: string })[],
  serversMeta: readonly DashboardTrafficServerMeta[] | undefined,
  locale: string,
  hiddenServerUuids?: ReadonlySet<string>,
): {
  servers: DashboardTrafficServerMeta[];
  rows: StackedDailyBillingRow[];
  totalsByServer: Record<string, number>;
  periodTotal: number;
} {
  const discovered = new Map<string, string>();
  for (const s of serversMeta ?? []) {
    if (s.uuid) discovered.set(s.uuid, s.name || s.uuid);
  }
  for (const d of daily) {
    if (!d.by_server) continue;
    for (const uid of Object.keys(d.by_server)) {
      if (!discovered.has(uid)) discovered.set(uid, uid);
    }
  }

  const totalsByServer: Record<string, number> = {};
  for (const uid of discovered.keys()) {
    totalsByServer[uid] = 0;
  }
  for (const d of daily) {
    if (!d.by_server) continue;
    for (const [uid, val] of Object.entries(d.by_server)) {
      const v = Math.max(0, Number(val) || 0);
      totalsByServer[uid] = (totalsByServer[uid] ?? 0) + v;
    }
  }

  const servers = Array.from(discovered.entries())
    .map(([uuid, name]) => ({ uuid, name }))
    .sort((a, b) => {
      const diff = (totalsByServer[b.uuid] ?? 0) - (totalsByServer[a.uuid] ?? 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });

  const periodTotal = Object.values(totalsByServer).reduce((sum, v) => sum + v, 0);

  const rows: StackedDailyBillingRow[] = daily.map((d) => {
    const label = d.label ?? shortDashboardDay(d.day, locale);
    const row: StackedDailyBillingRow = {
      day: d.day,
      label,
      billable: Math.max(0, Number(d.billable) || 0),
      topServerKey: "",
    };
    let visibleBillable = 0;
    for (const srv of servers) {
      const hidden = hiddenServerUuids?.has(srv.uuid) ?? false;
      const val = hidden ? 0 : Math.max(0, Number(d.by_server?.[srv.uuid]) || 0);
      const field = `srv_${srv.uuid}`;
      row[field] = val;
      if (val > 0) {
        row.topServerKey = field;
        visibleBillable += val;
      }
    }
    if (servers.length > 0 && d.by_server) {
      row.billable = visibleBillable;
    }
    return row;
  });

  return { servers, rows, totalsByServer, periodTotal };
}

export type DashboardTrafficDaySortKey = "name" | "up" | "down" | "billable";
export type DashboardTrafficDaySortDir = "asc" | "desc";

export function dashboardTrafficPeriod(traffic: DashboardChartsData["traffic"] | undefined) {
  const daily = traffic?.daily ?? [];
  const days = traffic?.period_days && traffic.period_days > 0 ? traffic.period_days : daily.length;
  const periodUp = traffic?.period_up ?? daily.reduce((sum, item) => sum + item.up, 0);
  const periodDown = traffic?.period_down ?? daily.reduce((sum, item) => sum + item.down, 0);
  const periodBillable = traffic?.period_billable ?? daily.reduce((sum, item) => sum + item.billable, 0);
  return {
    up: periodUp,
    down: periodDown,
    billable: periodBillable,
    days,
    averageUp: traffic?.daily_average_up ?? (days > 0 ? Math.floor(periodUp / days) : 0),
    averageDown: traffic?.daily_average_down ?? (days > 0 ? Math.floor(periodDown / days) : 0),
    averageBillable: traffic?.daily_average_billable ?? (days > 0 ? Math.floor(periodBillable / days) : 0),
  };
}

export function trafficDaySearchHaystack(item: DashboardTrafficRankItem): string {
  const tags = (item.tags || "")
    .split(";")
    .map((tag) => tag.replace(/<\w+>$/, "").trim())
    .filter(Boolean)
    .join(" ");
  return [item.name, item.uuid, item.ipv4, item.ipv6, item.group, item.tags, tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterAndSortTrafficDayItems(
  items: readonly DashboardTrafficRankItem[],
  query: string,
  sortKey: DashboardTrafficDaySortKey,
  sortDir: DashboardTrafficDaySortDir,
): DashboardTrafficRankItem[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? items.filter((item) => trafficDaySearchHaystack(item).includes(needle))
    : [...items];
  const direction = sortDir === "asc" ? 1 : -1;
  filtered.sort((left, right) => {
    if (sortKey === "name") {
      const byName = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      if (byName !== 0) return byName * direction;
      return left.uuid.localeCompare(right.uuid) * direction;
    }
    const delta = left[sortKey] - right[sortKey];
    if (delta !== 0) return delta * direction;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
  return filtered;
}

export function dashboardLocalStorageTotal(data: DashboardData): number | null {
  const measuredTotal = data.storage.database_files + data.storage.wal + data.storage.shm;
  if (typeof data.database.local_total === "number") {
    return measuredTotal;
  }
  if (data.database.main.location === "local") {
    return data.database.main.size;
  }
  return null;
}

export function dashboardRuntimeStorageTotal(data: DashboardData): number {
  return data.storage.wal + data.storage.shm;
}

export function dashboardOnlinePercent(data: DashboardData): number {
  if (data.servers.total <= 0) return 0;
  return Math.round((data.servers.online / data.servers.total) * 100);
}

export function shortDashboardDay(day: string, locale: string): string {
  const parsed = new Date(`${day}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(parsed);
}

export function dashboardTrafficAxisWidth(values: readonly number[]): number {
  const longestLabel = values.reduce((longest, value) => {
    if (!Number.isFinite(value)) return longest;
    const label = formatBytes(Math.max(0, value)).replace(" ", "");
    return Math.max(longest, label.length);
  }, 0);
  // Right-aligned ticks: extra width becomes a blank column to the left of the labels.
  return Math.min(76, Math.max(56, longestLabel * 7 + 12));
}

export const SUMMARY_FOOTER_CLASS = "km-summary-footer";
export const SUMMARY_FOOTER_STACK_CLASS = "km-summary-footer--stack";
export const SUMMARY_FOOTER_MEASURE_CLASS = "km-summary-footer--measure";

export function groupByVisualRow<T>(
  items: readonly T[],
  topOf: (item: T) => number,
  threshold = 8,
): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const top = topOf(item);
    const group = groups.find((candidate) => Math.abs(topOf(candidate[0]) - top) <= threshold);
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

export function summaryFooterNaturallyWraps(el: HTMLElement): boolean {
  el.classList.add(SUMMARY_FOOTER_MEASURE_CLASS);
  const kids = Array.from(el.children) as HTMLElement[];
  const wrapped = kids.length >= 2 && kids[1].offsetTop > kids[0].offsetTop + 1;
  el.classList.remove(SUMMARY_FOOTER_MEASURE_CLASS);
  return wrapped;
}

export function syncSummaryFooters(root: ParentNode): void {
  const footers = Array.from(root.querySelectorAll<HTMLElement>(`.${SUMMARY_FOOTER_CLASS}`));
  if (footers.length === 0) return;
  const groups = groupByVisualRow(footers, (el) => {
    const card = el.closest<HTMLElement>("[data-dashboard-module]");
    return (card ?? el).getBoundingClientRect().top;
  });
  for (const group of groups) {
    const shouldStack = group.some(summaryFooterNaturallyWraps);
    for (const el of group) {
      el.classList.toggle(SUMMARY_FOOTER_STACK_CLASS, shouldStack);
    }
  }
}
