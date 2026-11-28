export interface ThemeSettings {
  CustomBackgroundImage?: string;
  CustomMobileBackgroundImage?: string;
  CustomLogo?: string;
  ForceTheme?: string;
  ForcePeakCutEnabled?: boolean;
  ShowServerBandwidth?: boolean;
  DefaultBillingCurrency?: string;
  CnySymbolStyle?: string;
  [key: string]: unknown;
}

export interface PublicSettings {
  sitename?: string;
  description?: string;
  private_site?: boolean;
  theme?: string;
  theme_settings?: ThemeSettings;
  record_preserve_time?: number;
  ping_record_preserve_time?: number;
}

export interface MeInfo {
  username?: string;
  logged_in?: boolean;
  avatar_url?: string;
  language?: string;
}

export interface ThemeNode {
  uuid: string;
  name: string;
  cpu_name?: string;
  virtualization?: string;
  arch?: string;
  cpu_cores?: number;
  cpu_physical_cores?: number;
  os?: string;
  kernel_version?: string;
  gpu_name?: string;
  ipv4?: string;
  ipv6?: string;
  region?: string;
  region_override?: string;
  public_remark?: string;
  mem_total?: number;
  swap_total?: number;
  disk_total?: number;
  weight?: number;
  price?: number;
  billing_cycle?: number;
  auto_renewal?: boolean;
  currency?: string;
  expired_at?: string | null;
  expiry_timezone?: string;
  group?: string;
  tags?: string;
  bandwidth?: string;
  hidden?: boolean;
  traffic_limit?: number;
  traffic_limit_type?: string;
  traffic_reset_day?: number | null;
  traffic_reset_time?: string;
  traffic_reset_timezone?: string;
  traffic_reset_at?: string;
  effective_traffic_limit?: number;
  effective_traffic_type?: string;
  remaining_value?: string;
  remaining_value_currency?: string;
}

export interface PingSummaryStat {
  name: string;
  latest: number;
  avg: number;
  tail: number;
  loss: number;
  min: number;
  max: number;
}

export interface LiveNodeStatus {
  client: string;
  time: string;
  cpu: number;
  gpu?: number;
  ram: number;
  ram_total: number;
  swap: number;
  swap_total: number;
  load: number;
  load5?: number;
  load15?: number;
  temp?: number;
  disk: number;
  disk_total: number;
  net_in: number;
  net_out: number;
  net_total_up: number;
  net_total_down: number;
  process: number;
  connections: number;
  connections_udp: number;
  online: boolean;
  uptime: number;
  ping?: Record<string, PingSummaryStat>;
}

export interface PublicPingTask {
  id: number;
  name: string;
  clients?: string[];
  default_on?: boolean;
  type?: string;
  interval?: number;
  weight?: number;
}

export type ProbeTickState = "good" | "warn" | "bad" | "empty";

export interface ProbeTick {
  state: ProbeTickState;
  latency: number | null;
  loss: number | null;
  time: number | null;
}

export interface ResourceHistoryPoint {
  time: number;
  label: string;
  cpu: number;
  memPct: number;
  diskPct: number;
  netIn: number;
  netOut: number;
  load: number;
  connections: number;
  process: number;
}

export interface ProbeTaskDetail {
  id: string;
  name: string;
  type: string;
  latest: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p99: number | null;
  loss: number;
}

export interface ProbeHistoryDataset {
  tasks: ProbeTaskDetail[];
  points: Array<Record<string, number | string | null>>;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

class Rpc2Transport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (val: unknown) => void;
      reject: (err: Error) => void;
      timer: number;
    }
  >();
  private reconnectTimer: number | null = null;
  private listeners = new Set<(connected: boolean) => void>();
  public connected = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.connect();
    }
  }

  onStatusChange(fn: (connected: boolean) => void): () => void {
    this.listeners.add(fn);
    fn(this.connected);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private setConnected(val: boolean) {
    if (this.connected === val) return;
    this.connected = val;
    this.listeners.forEach((fn) => fn(val));
  }

  connect() {
    if (typeof window === "undefined") return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${proto}//${window.location.host}/api/rpc2`);
      this.ws = socket;

      socket.onopen = () => {
        this.setConnected(true);
      };

      socket.onmessage = (ev) => {
        try {
          const payload = JSON.parse(String(ev.data)) as JsonRpcResponse;
          if (typeof payload.id !== "number") return;
          const entry = this.pending.get(payload.id);
          if (!entry) return;
          this.pending.delete(payload.id);
          window.clearTimeout(entry.timer);
          if (payload.error) {
            entry.reject(new Error(payload.error.message || "RPC error"));
          } else {
            entry.resolve(payload.result);
          }
        } catch {
          // ignore malformed frames
        }
      };

      const handleClose = () => {
        this.setConnected(false);
        this.ws = null;
        for (const [id, entry] of this.pending.entries()) {
          this.pending.delete(id);
          window.clearTimeout(entry.timer);
          entry.reject(new Error("WebSocket closed"));
        }
        if (this.reconnectTimer === null) {
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, 2500);
        }
      };

      socket.onerror = handleClose;
      socket.onclose = handleClose;
    } catch {
      this.setConnected(false);
    }
  }

  async callHttp<T>(method: string, params?: unknown, timeoutMs = 15000): Promise<T> {
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("/api/rpc2", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as JsonRpcResponse<T>;
      if (json.error) throw new Error(json.error.message || "RPC error");
      return json.result as T;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async call<T>(method: string, params?: unknown, timeoutMs = 15000): Promise<T> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const id = this.nextId++;
      try {
        return await new Promise<T>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            this.pending.delete(id);
            reject(new Error("RPC timeout"));
          }, timeoutMs);
          this.pending.set(id, {
            resolve: resolve as (val: unknown) => void,
            reject,
            timer,
          });
          this.ws!.send(
            JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }),
          );
        });
      } catch {
        return this.callHttp<T>(method, params, timeoutMs);
      }
    }
    this.connect();
    return this.callHttp<T>(method, params, timeoutMs);
  }
}

export const rpcClient = new Rpc2Transport();

export async function fetchPublicSettings(): Promise<PublicSettings> {
  try {
    return await rpcClient.call<PublicSettings>("public:getPublicSettings");
  } catch {
    const res = await fetch("/api/public", { credentials: "same-origin" });
    const payload = (await res.json()) as { data?: PublicSettings };
    return payload.data ?? {};
  }
}

export async function fetchMeInfo(): Promise<MeInfo> {
  try {
    return await rpcClient.call<MeInfo>("public:getMe");
  } catch {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      return (await res.json()) as MeInfo;
    } catch {
      return { logged_in: false };
    }
  }
}

let cachedTasks: { at: number; items: PublicPingTask[] } | null = null;

export async function fetchPublicPingTasks(): Promise<PublicPingTask[]> {
  if (cachedTasks && Date.now() - cachedTasks.at < 60_000) {
    return cachedTasks.items;
  }
  try {
    const raw = await rpcClient.call<unknown>("public:getPublicPingTasks");
    const list = Array.isArray(raw) ? (raw as PublicPingTask[]) : [];
    cachedTasks = { at: Date.now(), items: list };
    return list;
  } catch {
    return cachedTasks?.items ?? [];
  }
}

export interface MetricPoint {
  time: string;
  value: number | null;
  count?: number;
  tags?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface MetricSeries {
  metric_key: string;
  entity_id: string;
  interval_seconds?: number;
  tags?: Record<string, string>;
  points?: MetricPoint[];
}

function extractTaskIdFromSeries(s: MetricSeries): string {
  const fromSeries = s.tags?.task_id || s.tags?.task;
  if (fromSeries) return String(fromSeries);
  const pt = s.points?.find((p) => p.tags?.task_id || p.labels?.task_id);
  return String(pt?.tags?.task_id || pt?.labels?.task_id || "");
}

function classifyTick(latency: number | null, lossRatio: number | null): ProbeTickState {
  if (lossRatio !== null && lossRatio >= 0.5) return "bad";
  if (latency === null || latency < 0) {
    return lossRatio !== null && lossRatio > 0 ? "bad" : "empty";
  }
  if ((lossRatio !== null && lossRatio > 0.05) || latency >= 220) return "warn";
  return "good";
}

export async function fetch1hProbeTicks(
  uuids: string[],
): Promise<Record<string, Record<string, ProbeTick[]>>> {
  const unique = Array.from(new Set(uuids.filter(Boolean)));
  if (unique.length === 0) return {};
  try {
    const resp = await rpcClient.call<{ series?: MetricSeries[] }>(
      "public:queryMetrics",
      {
        metric_keys: ["ping.latency_ms", "ping.loss"],
        entity_ids: unique,
        hours: 1,
        downsample: true,
        max_points: 10,
        aggregation: "avg",
        fill_empty: false,
      },
      15000,
    );
    const series = Array.isArray(resp?.series) ? resp.series : [];
    if (series.length === 0) return {};

    const lossMap = new Map<string, Map<number, number>>();
    for (const s of series) {
      if (s.metric_key !== "ping.loss" || !s.entity_id) continue;
      const tid = extractTaskIdFromSeries(s);
      if (!tid) continue;
      const key = `${s.entity_id}:${tid}`;
      const bucket = lossMap.get(key) ?? new Map<number, number>();
      for (const p of s.points ?? []) {
        const ts = Date.parse(p.time);
        if (Number.isFinite(ts) && p.value !== null && p.value !== undefined) {
          bucket.set(ts, Number(p.value));
        }
      }
      lossMap.set(key, bucket);
    }

    const out: Record<string, Record<string, ProbeTick[]>> = {};
    for (const s of series) {
      if (s.metric_key !== "ping.latency_ms" || !s.entity_id) continue;
      const tid = extractTaskIdFromSeries(s);
      if (!tid) continue;
      const lossBucket = lossMap.get(`${s.entity_id}:${tid}`);
      const pts = (s.points ?? [])
        .map((p) => {
          const ts = Date.parse(p.time);
          const lat = p.value === null || p.value === undefined ? null : Number(p.value);
          const loss = Number.isFinite(ts) && lossBucket?.has(ts) ? lossBucket.get(ts)! : null;
          return {
            time: Number.isFinite(ts) ? ts : null,
            latency: lat !== null && Number.isFinite(lat) ? lat : null,
            loss,
            state: classifyTick(lat, loss),
          } satisfies ProbeTick;
        })
        .slice(-10);

      while (pts.length < 10) {
        pts.unshift({ state: "empty", latency: null, loss: null, time: null });
      }
      out[s.entity_id] ??= {};
      out[s.entity_id][tid] = pts;
    }
    return out;
  } catch {
    return {};
  }
}

function formatAxisClock(ts: number, hours: number): string {
  const d = new Date(ts);
  if (hours <= 24) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`;
}

export async function fetchNodeResourceHistory(
  uuid: string,
  hours: number,
  memTotalFallback: number,
  diskTotalFallback: number,
): Promise<ResourceHistoryPoint[]> {
  try {
    const resp = await rpcClient.call<{
      records?: Array<{
        time: string;
        cpu?: number;
        ram?: number;
        ram_total?: number;
        disk?: number;
        disk_total?: number;
        net_in?: number;
        net_out?: number;
        load?: number;
        connections?: number;
        process?: number;
      }>;
    }>("public:getRecordsByUUID", {
      uuid,
      hours: String(hours),
      load_type: "all",
    });

    const rows = Array.isArray(resp?.records) ? resp.records : [];
    if (rows.length > 0) {
      const step = Math.max(1, Math.ceil(rows.length / 180));
      const sampled = rows.filter((_, idx) => idx % step === 0 || idx === rows.length - 1);
      return sampled
        .map((r) => {
          const ts = Date.parse(r.time);
          if (!Number.isFinite(ts)) return null;
          const memTot = Number(r.ram_total) || memTotalFallback;
          const diskTot = Number(r.disk_total) || diskTotalFallback;
          return {
            time: ts,
            label: formatAxisClock(ts, hours),
            cpu: Math.max(0, Number(r.cpu) || 0),
            memPct: memTot > 0 ? Math.min(100, Math.max(0, ((Number(r.ram) || 0) / memTot) * 100)) : 0,
            diskPct: diskTot > 0 ? Math.min(100, Math.max(0, ((Number(r.disk) || 0) / diskTot) * 100)) : 0,
            netIn: Math.max(0, Number(r.net_in) || 0),
            netOut: Math.max(0, Number(r.net_out) || 0),
            load: Math.max(0, Number(r.load) || 0),
            connections: Math.max(0, Number(r.connections) || 0),
            process: Math.max(0, Number(r.process) || 0),
          } satisfies ResourceHistoryPoint;
        })
        .filter((item): item is ResourceHistoryPoint => item !== null);
    }
  } catch {
    // fallback to metric store below
  }

  try {
    const resp = await rpcClient.call<{ series?: MetricSeries[] }>("public:queryMetrics", {
      metric_keys: ["cpu.usage", "memory.used", "disk.used"],
      entity_id: uuid,
      hours,
      downsample: true,
      max_points: 120,
      aggregation: "avg",
      fill_empty: false,
    });
    const byTime = new Map<number, ResourceHistoryPoint>();
    for (const s of resp?.series ?? []) {
      for (const p of s.points ?? []) {
        const ts = Date.parse(p.time);
        if (!Number.isFinite(ts) || p.value === null) continue;
        const row =
          byTime.get(ts) ??
          ({
            time: ts,
            label: formatAxisClock(ts, hours),
            cpu: 0,
            memPct: 0,
            diskPct: 0,
            netIn: 0,
            netOut: 0,
            load: 0,
            connections: 0,
            process: 0,
          } satisfies ResourceHistoryPoint);
        if (s.metric_key === "cpu.usage") row.cpu = Math.max(0, Number(p.value) || 0);
        if (s.metric_key === "memory.used" && memTotalFallback > 0) {
          row.memPct = Math.min(100, Math.max(0, (Number(p.value) / memTotalFallback) * 100));
        }
        if (s.metric_key === "disk.used" && diskTotalFallback > 0) {
          row.diskPct = Math.min(100, Math.max(0, (Number(p.value) / diskTotalFallback) * 100));
        }
        byTime.set(ts, row);
      }
    }
    return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export async function fetchNodePingHistory(
  uuid: string,
  hours: number,
): Promise<ProbeHistoryDataset> {
  try {
    const resp = await rpcClient.call<{
      records?: Array<{ task_id?: number; time: string; value: number }>;
      tasks?: Array<{
        id: number;
        name: string;
        type?: string;
        loss?: number;
        min?: number;
        max?: number;
        avg?: number;
      }>;
    }>("public:getPingRecords", {
      uuid,
      hours: String(hours),
    });

    const records = Array.isArray(resp?.records) ? resp.records : [];
    const rawTasks = Array.isArray(resp?.tasks) ? resp.tasks : [];

    const samplesByTask = new Map<string, Array<{ ts: number; val: number }>>();
    for (const r of records) {
      const tid = String(r.task_id ?? "");
      const ts = Date.parse(r.time);
      if (!tid || !Number.isFinite(ts)) continue;
      const list = samplesByTask.get(tid) ?? [];
      list.push({ ts, val: Number(r.value) });
      samplesByTask.set(tid, list);
    }

    const tasks: ProbeTaskDetail[] = rawTasks.map((t) => {
      const tid = String(t.id);
      const list = (samplesByTask.get(tid) ?? []).sort((a, b) => a.ts - b.ts);
      const valid = list.filter((x) => x.val >= 0).map((x) => x.val);
      const sorted = [...valid].sort((a, b) => a - b);
      const latest = valid.length > 0 ? valid[valid.length - 1] : null;
      return {
        id: tid,
        name: t.name || `Task ${tid}`,
        type: (t.type || "ICMP").toUpperCase(),
        latest,
        avg: valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : t.avg ?? null,
        min: sorted.length > 0 ? sorted[0] : t.min ?? null,
        max: sorted.length > 0 ? sorted[sorted.length - 1] : t.max ?? null,
        p50: percentile(sorted, 0.5),
        p99: percentile(sorted, 0.99),
        loss: Number(t.loss) || 0,
      };
    });

    // Bucket timestamps into ~120 evenly-spaced slots for smooth multi-series chart
    if (records.length === 0 || tasks.length === 0) {
      return { tasks, points: [] };
    }
    const allTs = records.map((r) => Date.parse(r.time)).filter(Number.isFinite);
    const minTs = Math.min(...allTs);
    const maxTs = Math.max(...allTs);
    const bucketCount = Math.min(120, Math.max(20, Math.floor(records.length / Math.max(1, tasks.length))));
    const bucketSpan = Math.max(1000, Math.ceil((maxTs - minTs + 1) / bucketCount));

    const buckets = new Map<number, Record<string, { sum: number; count: number }>>();
    for (const r of records) {
      if (r.value < 0) continue;
      const ts = Date.parse(r.time);
      if (!Number.isFinite(ts)) continue;
      const slot = minTs + Math.floor((ts - minTs) / bucketSpan) * bucketSpan;
      const tid = String(r.task_id ?? "");
      const row = buckets.get(slot) ?? {};
      const acc = row[tid] ?? { sum: 0, count: 0 };
      acc.sum += r.value;
      acc.count += 1;
      row[tid] = acc;
      buckets.set(slot, row);
    }

    const points = Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([slot, row]) => {
        const entry: Record<string, number | string | null> = {
          time: slot,
          label: formatAxisClock(slot, hours),
        };
        for (const t of tasks) {
          const acc = row[t.id];
          entry[`task_${t.id}`] = acc && acc.count > 0 ? Number((acc.sum / acc.count).toFixed(2)) : null;
        }
        return entry;
      });

    return { tasks, points };
  } catch {
    return { tasks: [], points: [] };
  }
}

export type OverviewHoursWindow = 1 | 6 | 12 | 24 | 168;
export type TrafficMetricMode = "bytes" | "rate";
export type TrafficDirectionMode = "both" | "up" | "down";
export type PingMetricMode = "latency" | "loss";

export const ALL_SERVERS_SERIES_KEY = "__all__";

export interface EntityTrafficBucketSample {
  upBytes: number;
  downBytes: number;
  upRate: number;
  downRate: number;
}

export interface MultiNodeTrafficBucket {
  time: number;
  label: string;
  byEntity: Record<string, EntityTrafficBucketSample>;
}

export interface EntityTrafficWindowSummary {
  upBytes: number;
  downBytes: number;
  totalBytes: number;
  avgUpRate: number;
  avgDownRate: number;
  avgTotalRate: number;
}

export interface MultiNodeTrafficDataset {
  buckets: MultiNodeTrafficBucket[];
  summaryByEntity: Record<string, EntityTrafficWindowSummary>;
}

export interface MultiNodePingTaskSample {
  latency: number | null;
  lossPct: number | null;
  validCount: number;
  totalCount: number;
}

export interface MultiNodePingBucket {
  time: number;
  label: string;
  byEntityTask: Record<string, Record<string, MultiNodePingTaskSample>>;
}

export interface MultiNodePingDataset {
  buckets: MultiNodePingBucket[];
  taskIds: string[];
}

function defaultBucketSecondsForHours(hours: number): number {
  if (hours <= 1) return 60;
  if (hours <= 6) return 300;
  if (hours <= 12) return 600;
  if (hours <= 24) return 900;
  return 7200;
}

export function buildMultiNodeTrafficDataset(
  series: MetricSeries[],
  uuids: string[],
  hours: number,
): MultiNodeTrafficDataset {
  const uniqueUuids = Array.from(new Set(uuids.filter(Boolean)));
  const uuidSet = new Set(uniqueUuids);
  if (uniqueUuids.length === 0 || series.length === 0) {
    return { buckets: [], summaryByEntity: {} };
  }

  let maxIntervalSec = 0;
  for (const s of series) {
    if (s.interval_seconds && s.interval_seconds > maxIntervalSec) {
      maxIntervalSec = s.interval_seconds;
    }
  }
  const bucketSec = maxIntervalSec > 0 ? maxIntervalSec : defaultBucketSecondsForHours(hours);
  const bucketMs = Math.max(10_000, Math.round(bucketSec * 1000));

  interface RawTrafficCell {
    upBytes: number;
    downBytes: number;
    hasBytesUp: boolean;
    hasBytesDown: boolean;
    upRateSum: number;
    upRateCount: number;
    downRateSum: number;
    downRateCount: number;
  }

  const slotMap = new Map<number, Map<string, RawTrafficCell>>();

  for (const s of series) {
    if (!s.entity_id || !uuidSet.has(s.entity_id)) continue;
    for (const p of s.points ?? []) {
      if (p.value === null || p.value === undefined) continue;
      const ts = Date.parse(p.time);
      const val = Math.max(0, Number(p.value) || 0);
      if (!Number.isFinite(ts)) continue;
      const slot = Math.floor(ts / bucketMs) * bucketMs;
      let entityMap = slotMap.get(slot);
      if (!entityMap) {
        entityMap = new Map();
        slotMap.set(slot, entityMap);
      }
      let cell = entityMap.get(s.entity_id);
      if (!cell) {
        cell = {
          upBytes: 0,
          downBytes: 0,
          hasBytesUp: false,
          hasBytesDown: false,
          upRateSum: 0,
          upRateCount: 0,
          downRateSum: 0,
          downRateCount: 0,
        };
        entityMap.set(s.entity_id, cell);
      }

      switch (s.metric_key) {
        case "traffic.up":
          cell.upBytes += val;
          cell.hasBytesUp = true;
          break;
        case "traffic.down":
          cell.downBytes += val;
          cell.hasBytesDown = true;
          break;
        case "net.out.rate":
          cell.upRateSum += val;
          cell.upRateCount += 1;
          break;
        case "net.in.rate":
          cell.downRateSum += val;
          cell.downRateCount += 1;
          break;
      }
    }
  }

  const sortedSlots = Array.from(slotMap.keys()).sort((a, b) => a - b);
  if (sortedSlots.length === 0) {
    return { buckets: [], summaryByEntity: {} };
  }

  const accSummary = new Map<
    string,
    {
      upBytes: number;
      downBytes: number;
      upRateSum: number;
      downRateSum: number;
      rateSamples: number;
    }
  >();

  const ensureSummary = (key: string) => {
    let cur = accSummary.get(key);
    if (!cur) {
      cur = { upBytes: 0, downBytes: 0, upRateSum: 0, downRateSum: 0, rateSamples: 0 };
      accSummary.set(key, cur);
    }
    return cur;
  };

  const buckets: MultiNodeTrafficBucket[] = sortedSlots.map((slot) => {
    const entityMap = slotMap.get(slot)!;
    const byEntity: Record<string, EntityTrafficBucketSample> = {};
    let allUpBytes = 0;
    let allDownBytes = 0;
    let allUpRate = 0;
    let allDownRate = 0;

    for (const [uid, cell] of entityMap.entries()) {
      const upRate = cell.upRateCount > 0 ? cell.upRateSum / cell.upRateCount : 0;
      const downRate = cell.downRateCount > 0 ? cell.downRateSum / cell.downRateCount : 0;
      const upBytes = cell.hasBytesUp
        ? cell.upBytes
        : cell.upRateCount > 0
          ? upRate * bucketSec
          : 0;
      const downBytes = cell.hasBytesDown
        ? cell.downBytes
        : cell.downRateCount > 0
          ? downRate * bucketSec
          : 0;
      const effectiveUpRate = cell.upRateCount > 0 ? upRate : upBytes / bucketSec;
      const effectiveDownRate = cell.downRateCount > 0 ? downRate : downBytes / bucketSec;

      byEntity[uid] = {
        upBytes,
        downBytes,
        upRate: effectiveUpRate,
        downRate: effectiveDownRate,
      };

      allUpBytes += upBytes;
      allDownBytes += downBytes;
      allUpRate += effectiveUpRate;
      allDownRate += effectiveDownRate;

      const s = ensureSummary(uid);
      s.upBytes += upBytes;
      s.downBytes += downBytes;
      s.upRateSum += effectiveUpRate;
      s.downRateSum += effectiveDownRate;
      s.rateSamples += 1;
    }

    byEntity[ALL_SERVERS_SERIES_KEY] = {
      upBytes: allUpBytes,
      downBytes: allDownBytes,
      upRate: allUpRate,
      downRate: allDownRate,
    };

    const allSum = ensureSummary(ALL_SERVERS_SERIES_KEY);
    allSum.upBytes += allUpBytes;
    allSum.downBytes += allDownBytes;
    allSum.upRateSum += allUpRate;
    allSum.downRateSum += allDownRate;
    allSum.rateSamples += 1;

    return {
      time: slot,
      label: formatAxisClock(slot, hours),
      byEntity,
    };
  });

  const summaryByEntity: Record<string, EntityTrafficWindowSummary> = {};
  for (const key of [ALL_SERVERS_SERIES_KEY, ...uniqueUuids]) {
    const item = accSummary.get(key);
    if (!item) {
      summaryByEntity[key] = {
        upBytes: 0,
        downBytes: 0,
        totalBytes: 0,
        avgUpRate: 0,
        avgDownRate: 0,
        avgTotalRate: 0,
      };
      continue;
    }
    const avgUp = item.rateSamples > 0 ? item.upRateSum / item.rateSamples : 0;
    const avgDown = item.rateSamples > 0 ? item.downRateSum / item.rateSamples : 0;
    summaryByEntity[key] = {
      upBytes: item.upBytes,
      downBytes: item.downBytes,
      totalBytes: item.upBytes + item.downBytes,
      avgUpRate: avgUp,
      avgDownRate: avgDown,
      avgTotalRate: avgUp + avgDown,
    };
  }

  return { buckets, summaryByEntity };
}

export function projectTrafficChartData(
  dataset: MultiNodeTrafficDataset,
  uuids: string[],
  metricMode: TrafficMetricMode,
  direction: TrafficDirectionMode,
): {
  points: Array<Record<string, number | string | null>>;
  valueByEntity: Record<string, number>;
} {
  const keys = [ALL_SERVERS_SERIES_KEY, ...uuids];
  const pickSample = (sample?: EntityTrafficBucketSample): number | null => {
    if (!sample) return null;
    if (metricMode === "bytes") {
      if (direction === "up") return sample.upBytes;
      if (direction === "down") return sample.downBytes;
      return sample.upBytes + sample.downBytes;
    }
    if (direction === "up") return sample.upRate;
    if (direction === "down") return sample.downRate;
    return sample.upRate + sample.downRate;
  };

  const points = dataset.buckets.map((bucket) => {
    const row: Record<string, number | string | null> = {
      time: bucket.time,
      label: bucket.label,
    };
    for (const key of keys) {
      row[key] = pickSample(bucket.byEntity[key]);
    }
    return row;
  });

  const valueByEntity: Record<string, number> = {};
  for (const key of keys) {
    const sum = dataset.summaryByEntity[key];
    if (!sum) {
      valueByEntity[key] = 0;
      continue;
    }
    if (metricMode === "bytes") {
      valueByEntity[key] =
        direction === "up"
          ? sum.upBytes
          : direction === "down"
            ? sum.downBytes
            : sum.totalBytes;
    } else {
      valueByEntity[key] =
        direction === "up"
          ? sum.avgUpRate
          : direction === "down"
            ? sum.avgDownRate
            : sum.avgTotalRate;
    }
  }

  return { points, valueByEntity };
}

export function buildMultiNodePingDataset(
  series: MetricSeries[],
  uuids: string[],
  hours: number,
): MultiNodePingDataset {
  const uniqueUuids = Array.from(new Set(uuids.filter(Boolean)));
  const uuidSet = new Set(uniqueUuids);
  if (uniqueUuids.length === 0 || series.length === 0) {
    return { buckets: [], taskIds: [] };
  }

  let maxIntervalSec = 0;
  for (const s of series) {
    if (s.interval_seconds && s.interval_seconds > maxIntervalSec) {
      maxIntervalSec = s.interval_seconds;
    }
  }
  const bucketSec = maxIntervalSec > 0 ? maxIntervalSec : defaultBucketSecondsForHours(hours);
  const bucketMs = Math.max(10_000, Math.round(bucketSec * 1000));

  interface RawPingCell {
    latWeightedSum: number;
    latWeight: number;
    hasNegativeSentinel: boolean;
    lossWeightedSum: number;
    lossWeight: number;
  }

  const slotMap = new Map<number, Map<string, Map<string, RawPingCell>>>();
  const discoveredTaskIds = new Set<string>();

  const getCell = (slot: number, entityId: string, taskId: string): RawPingCell => {
    let byEntity = slotMap.get(slot);
    if (!byEntity) {
      byEntity = new Map();
      slotMap.set(slot, byEntity);
    }
    let byTask = byEntity.get(entityId);
    if (!byTask) {
      byTask = new Map();
      byEntity.set(entityId, byTask);
    }
    let cell = byTask.get(taskId);
    if (!cell) {
      cell = {
        latWeightedSum: 0,
        latWeight: 0,
        hasNegativeSentinel: false,
        lossWeightedSum: 0,
        lossWeight: 0,
      };
      byTask.set(taskId, cell);
    }
    return cell;
  };

  for (const s of series) {
    if (!s.entity_id || !uuidSet.has(s.entity_id)) continue;
    const seriesTid = extractTaskIdFromSeries(s);
    for (const p of s.points ?? []) {
      if (p.value === null || p.value === undefined) continue;
      const tid = String(seriesTid || p.tags?.task_id || p.labels?.task_id || "");
      if (!tid) continue;
      const ts = Date.parse(p.time);
      if (!Number.isFinite(ts)) continue;
      discoveredTaskIds.add(tid);

      const slot = Math.floor(ts / bucketMs) * bucketMs;
      const count = Math.max(1, Number(p.count) || 1);
      const val = Number(p.value);
      if (!Number.isFinite(val)) continue;
      const cell = getCell(slot, s.entity_id, tid);

      if (s.metric_key === "ping.latency_ms") {
        if (val < 0) {
          cell.hasNegativeSentinel = true;
          if (cell.lossWeight === 0) {
            cell.lossWeightedSum += count;
            cell.lossWeight += count;
          }
        } else {
          cell.latWeightedSum += val * count;
          cell.latWeight += count;
        }
      } else if (s.metric_key === "ping.loss") {
        const clampedRatio = Math.min(1, Math.max(0, val));
        cell.lossWeightedSum += clampedRatio * count;
        cell.lossWeight += count;
      }
    }
  }

  const sortedSlots = Array.from(slotMap.keys()).sort((a, b) => a - b);
  const buckets: MultiNodePingBucket[] = sortedSlots.map((slot) => {
    const byEntity = slotMap.get(slot)!;
    const byEntityTask: Record<string, Record<string, MultiNodePingTaskSample>> = {};

    for (const [entityId, byTask] of byEntity.entries()) {
      byEntityTask[entityId] = {};
      for (const [tid, cell] of byTask.entries()) {
        const lossRatio =
          cell.lossWeight > 0 ? cell.lossWeightedSum / cell.lossWeight : null;
        const allFailed =
          (lossRatio !== null && lossRatio >= 0.9999) ||
          (cell.latWeight === 0 && cell.hasNegativeSentinel);
        const totalCount = Math.max(cell.lossWeight, cell.latWeight, 1);
        const validCount =
          lossRatio !== null
            ? Math.max(0, Math.round(totalCount * (1 - lossRatio)))
            : cell.latWeight;

        const latency =
          !allFailed && cell.latWeight > 0
            ? Number((cell.latWeightedSum / cell.latWeight).toFixed(2))
            : null;
        const lossPct =
          lossRatio !== null
            ? Number((lossRatio * 100).toFixed(2))
            : cell.latWeight > 0
              ? 0
              : null;

        byEntityTask[entityId][tid] = {
          latency,
          lossPct,
          validCount: latency !== null ? Math.max(1, validCount) : 0,
          totalCount,
        };
      }
    }

    return {
      time: slot,
      label: formatAxisClock(slot, hours),
      byEntityTask,
    };
  });

  const taskIds = Array.from(discoveredTaskIds).sort((a, b) => Number(a) - Number(b));
  return { buckets, taskIds };
}

export function projectPingChartData(
  dataset: MultiNodePingDataset,
  uuids: string[],
  metricMode: PingMetricMode,
  taskFilter: string,
  peakCut: boolean,
): {
  points: Array<Record<string, number | string | null>>;
  avgByEntity: Record<string, number | null>;
  fleetAvg: number | null;
} {
  const entityAcc = new Map<string, { sum: number; weight: number }>();

  const rawPoints = dataset.buckets.map((bucket) => {
    const row: Record<string, number | string | null> = {
      time: bucket.time,
      label: bucket.label,
    };

    for (const uid of uuids) {
      const taskMap = bucket.byEntityTask[uid];
      if (!taskMap) {
        row[uid] = null;
        continue;
      }

      const samples: MultiNodePingTaskSample[] =
        taskFilter === ALL_SERVERS_SERIES_KEY
          ? Object.values(taskMap)
          : taskMap[taskFilter]
            ? [taskMap[taskFilter]]
            : [];

      if (samples.length === 0) {
        row[uid] = null;
        continue;
      }

      if (metricMode === "latency") {
        let wSum = 0;
        let wCount = 0;
        for (const s of samples) {
          if (s.latency !== null && Number.isFinite(s.latency)) {
            const w = Math.max(1, s.validCount);
            wSum += s.latency * w;
            wCount += w;
          }
        }
        if (wCount > 0) {
          const val = Number((wSum / wCount).toFixed(2));
          row[uid] = val;
          const acc = entityAcc.get(uid) ?? { sum: 0, weight: 0 };
          acc.sum += wSum;
          acc.weight += wCount;
          entityAcc.set(uid, acc);
        } else {
          row[uid] = null;
        }
      } else {
        let lSum = 0;
        let lCount = 0;
        for (const s of samples) {
          if (s.lossPct !== null && Number.isFinite(s.lossPct)) {
            const w = Math.max(1, s.totalCount);
            lSum += s.lossPct * w;
            lCount += w;
          }
        }
        if (lCount > 0) {
          const val = Number((lSum / lCount).toFixed(2));
          row[uid] = val;
          const acc = entityAcc.get(uid) ?? { sum: 0, weight: 0 };
          acc.sum += lSum;
          acc.weight += lCount;
          entityAcc.set(uid, acc);
        } else {
          row[uid] = null;
        }
      }
    }

    return row;
  });

  let points = rawPoints;
  if (metricMode === "latency" && peakCut && rawPoints.length > 0) {
    const allPositive: number[] = [];
    for (const row of rawPoints) {
      for (const uid of uuids) {
        const v = row[uid];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) {
          allPositive.push(v);
        }
      }
    }
    if (allPositive.length >= 6) {
      allPositive.sort((a, b) => a - b);
      const q1 = percentile(allPositive, 0.25) ?? allPositive[0];
      const q3 = percentile(allPositive, 0.75) ?? allPositive[allPositive.length - 1];
      const p95 = percentile(allPositive, 0.95) ?? q3;
      const iqr = Math.max(1, q3 - q1);
      const ceiling = Math.max(q3 + iqr * 2.2, p95 * 1.12);
      points = rawPoints.map((row) => {
        const next: Record<string, number | string | null> = { ...row };
        for (const uid of uuids) {
          const v = next[uid];
          if (typeof v === "number" && v > ceiling) {
            next[uid] = Number(ceiling.toFixed(2));
          }
        }
        return next;
      });
    }
  }

  const avgByEntity: Record<string, number | null> = {};
  let fleetSum = 0;
  let fleetEntities = 0;
  for (const uid of uuids) {
    const acc = entityAcc.get(uid);
    if (acc && acc.weight > 0) {
      const avg = Number((acc.sum / acc.weight).toFixed(2));
      avgByEntity[uid] = avg;
      fleetSum += avg;
      fleetEntities += 1;
    } else {
      avgByEntity[uid] = null;
    }
  }

  return {
    points,
    avgByEntity,
    fleetAvg: fleetEntities > 0 ? Number((fleetSum / fleetEntities).toFixed(2)) : null,
  };
}

const multiTrafficCache = new Map<
  string,
  { at: number; data: MultiNodeTrafficDataset }
>();
const multiPingCache = new Map<string, { at: number; data: MultiNodePingDataset }>();
const OVERVIEW_CACHE_TTL_MS = 25_000;

export async function fetchMultiNodeTrafficDataset(
  uuids: string[],
  hours: OverviewHoursWindow,
): Promise<MultiNodeTrafficDataset> {
  const unique = Array.from(new Set(uuids.filter(Boolean))).sort();
  if (unique.length === 0) return { buckets: [], summaryByEntity: {} };

  const cacheKey = `${hours}:${unique.join(",")}`;
  const hit = multiTrafficCache.get(cacheKey);
  if (hit && Date.now() - hit.at < OVERVIEW_CACHE_TTL_MS) {
    return hit.data;
  }

  const maxPoints = hours <= 1 ? 60 : hours <= 6 ? 72 : hours <= 24 ? 96 : 112;
  try {
    const resp = await rpcClient.call<{ series?: MetricSeries[] }>(
      "public:queryMetrics",
      {
        metric_keys: ["traffic.up", "traffic.down", "net.out.rate", "net.in.rate"],
        entity_ids: unique,
        hours,
        downsample: true,
        max_points: maxPoints,
        aggregation_by_metric: {
          "traffic.up": "sum",
          "traffic.down": "sum",
          "net.out.rate": "avg",
          "net.in.rate": "avg",
        },
        fill_empty: false,
      },
      20_000,
    );
    const dataset = buildMultiNodeTrafficDataset(resp?.series ?? [], unique, hours);
    multiTrafficCache.set(cacheKey, { at: Date.now(), data: dataset });
    return dataset;
  } catch {
    return hit?.data ?? { buckets: [], summaryByEntity: {} };
  }
}

export async function fetchMultiNodePingDataset(
  uuids: string[],
  hours: OverviewHoursWindow,
): Promise<MultiNodePingDataset> {
  const unique = Array.from(new Set(uuids.filter(Boolean))).sort();
  if (unique.length === 0) return { buckets: [], taskIds: [] };

  const cacheKey = `${hours}:${unique.join(",")}`;
  const hit = multiPingCache.get(cacheKey);
  if (hit && Date.now() - hit.at < OVERVIEW_CACHE_TTL_MS) {
    return hit.data;
  }

  const maxPoints = hours <= 1 ? 60 : hours <= 6 ? 72 : hours <= 24 ? 96 : 112;
  try {
    const resp = await rpcClient.call<{ series?: MetricSeries[] }>(
      "public:queryMetrics",
      {
        metric_keys: ["ping.latency_ms", "ping.loss"],
        entity_ids: unique,
        hours,
        downsample: true,
        max_points: maxPoints,
        aggregation: "avg",
        fill_empty: false,
      },
      20_000,
    );
    const dataset = buildMultiNodePingDataset(resp?.series ?? [], unique, hours);
    multiPingCache.set(cacheKey, { at: Date.now(), data: dataset });
    return dataset;
  } catch {
    return hit?.data ?? { buckets: [], taskIds: [] };
  }
}
