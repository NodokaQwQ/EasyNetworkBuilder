import type { MessageKey } from "@/i18n/locales";

export interface FormattedSize {
  value: string;
  unit: string;
  full: string;
}

export function formatBytesParts(bytes: number | null | undefined, decimals = 2): FormattedSize {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) {
    return { value: "0.00", unit: "B", full: "0 B" };
  }
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  const fixed = idx === 0 ? String(Math.round(val)) : val.toFixed(val >= 100 ? 1 : decimals);
  return { value: fixed, unit: units[idx], full: `${fixed} ${units[idx]}` };
}

export function formatSpeedParts(bytesPerSec: number | null | undefined): FormattedSize {
  const n = Number(bytesPerSec);
  if (!Number.isFinite(n) || n <= 0) {
    return { value: "0.00", unit: "B/s", full: "0.00 B/s" };
  }
  const units = ["B/s", "K/s", "M/s", "G/s", "T/s"];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  const fixed = val >= 100 ? val.toFixed(1) : val.toFixed(2);
  return { value: fixed, unit: units[idx], full: `${fixed} ${units[idx]}` };
}

export function clampPercent(used?: number | null, total?: number | null): number {
  const u = Number(used);
  const t = Number(total);
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return 0;
  return Math.min(100, Math.max(0, (u / t) * 100));
}

export function computeCycleTrafficUsed(
  limitType: string | undefined,
  up: number,
  down: number,
): number {
  const u = Math.max(0, Number(up) || 0);
  const d = Math.max(0, Number(down) || 0);
  switch ((limitType || "sum").toLowerCase()) {
    case "max":
      return Math.max(u, d);
    case "min":
      return Math.min(u, d);
    case "up":
      return u;
    case "down":
      return d;
    case "sum":
    default:
      return u + d;
  }
}

export function computeResetDaysLeft(
  resetAt?: string | null,
  resetDay?: number | null,
): number | null {
  if (resetAt) {
    const target = Date.parse(resetAt);
    if (Number.isFinite(target)) {
      const diff = target - Date.now();
      return Math.max(0, Math.ceil(diff / 86_400_000));
    }
  }
  const day = Number(resetDay);
  if (!Number.isFinite(day) || day <= 0 || day > 31) return null;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const maxDayThisMonth = new Date(year, month + 1, 0).getDate();
  let candidate = new Date(year, month, Math.min(day, maxDayThisMonth), 0, 0, 0);
  if (candidate.getTime() < now.getTime() - 86_400_000 + 1000) {
    const maxDayNext = new Date(year, month + 2, 0).getDate();
    candidate = new Date(year, month + 1, Math.min(day, maxDayNext), 0, 0, 0);
  }
  return Math.max(0, Math.ceil((candidate.getTime() - now.getTime()) / 86_400_000));
}

export function isLongTermDate(expiredAt?: string | null): boolean {
  if (!expiredAt) return true;
  const parsed = Date.parse(expiredAt);
  if (!Number.isFinite(parsed)) return true;
  const year = new Date(parsed).getUTCFullYear();
  return year <= 1971 || year >= 2200;
}

export function computeExpiryDaysLeft(expiredAt?: string | null): number | null {
  if (isLongTermDate(expiredAt)) return null;
  const parsed = Date.parse(expiredAt!);
  return Math.ceil((parsed - Date.now()) / 86_400_000);
}

export function formatCurrencySymbol(
  rawCurrency: string | undefined,
  defaultCurrency?: string,
  cnyStyle?: string,
): string {
  const code = (
    rawCurrency?.trim() ||
    (defaultCurrency && defaultCurrency !== "跟随后端" ? defaultCurrency : "$")
  ).toUpperCase();
  if (code === "CNY" || code === "RMB" || code === "￥" || code === "¥") {
    return cnyStyle === "CNY" ? "CNY " : "¥";
  }
  const map: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "JP¥",
    HKD: "HK$",
    TWD: "NT$",
    CAD: "C$",
    AUD: "A$",
    SGD: "S$",
    KRW: "₩",
  };
  return map[code] ?? rawCurrency?.trim() ?? "$";
}

export function formatUptime(
  seconds: number | undefined,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s <= 0) return "—";
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days} ${t("daysUnit")} ${hours} ${t("hoursUnit")}`;
  if (hours > 0) return `${hours} ${t("hoursUnit")} ${mins} ${t("minsUnit")}`;
  return `${Math.max(1, mins)} ${t("minsUnit")}`;
}

export function shortOsName(os?: string): string {
  if (!os) return "Linux";
  const clean = os.trim();
  const known = [
    ["Alpine", "Alpine"],
    ["Debian", "Debian"],
    ["Ubuntu", "Ubuntu"],
    ["Arch", "Arch"],
    ["CentOS", "CentOS"],
    ["Rocky", "Rocky"],
    ["Alma", "AlmaLinux"],
    ["Fedora", "Fedora"],
    ["Windows", "Windows"],
    ["Darwin", "macOS"],
    ["macOS", "macOS"],
    ["FreeBSD", "FreeBSD"],
    ["OpenWrt", "OpenWrt"],
  ] as const;
  for (const [needle, label] of known) {
    if (clean.toLowerCase().includes(needle.toLowerCase())) return label;
  }
  return clean.split(/\s+/)[0] || "Linux";
}

const REGION_ALIASES: Record<string, string> = {
  hongkong: "HK",
  "hong kong": "HK",
  香港: "HK",
  china: "CN",
  中国: "CN",
  taiwan: "TW",
  台湾: "TW",
  台灣: "TW",
  macao: "MO",
  macau: "MO",
  澳门: "MO",
  japan: "JP",
  日本: "JP",
  korea: "KR",
  "south korea": "KR",
  韩国: "KR",
  singapore: "SG",
  新加坡: "SG",
  malaysia: "MY",
  马来西亚: "MY",
  usa: "US",
  "united states": "US",
  america: "US",
  美国: "US",
  canada: "CA",
  加拿大: "CA",
  uk: "GB",
  britain: "GB",
  "united kingdom": "GB",
  英国: "GB",
  germany: "DE",
  德国: "DE",
  france: "FR",
  法国: "FR",
  netherlands: "NL",
  荷兰: "NL",
  russia: "RU",
  俄罗斯: "RU",
  australia: "AU",
  澳大利亚: "AU",
  india: "IN",
  印度: "IN",
  brazil: "BR",
  巴西: "BR",
};

export function resolveCountryCode(region?: string | null): string {
  const raw = (region || "").trim();
  if (!raw) return "UN";

  // Emoji regional indicator pair (e.g. 🇲🇾 -> MY, 🇺🇸 -> US)
  const chars = Array.from(raw);
  if (chars.length >= 2) {
    const c1 = chars[0].codePointAt(0) ?? 0;
    const c2 = chars[1].codePointAt(0) ?? 0;
    if (c1 >= 0x1f1e6 && c1 <= 0x1f1ff && c2 >= 0x1f1e6 && c2 <= 0x1f1ff) {
      return (
        String.fromCodePoint(c1 - 0x1f1e6 + 65) +
        String.fromCodePoint(c2 - 0x1f1e6 + 65)
      );
    }
  }

  if (/^[A-Za-z]{2}$/.test(raw)) {
    const up = raw.toUpperCase();
    return up === "UK" ? "GB" : up;
  }

  const lower = raw.toLowerCase();
  if (REGION_ALIASES[lower]) return REGION_ALIASES[lower];
  return "UN";
}

export function parseNodeTags(tags?: string | null): string[] {
  if (!tags) return [];
  return tags
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function greetingKeyByHour(date = new Date()): MessageKey {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "greetingMorning";
  if (h >= 12 && h < 18) return "greetingAfternoon";
  return "greetingEvening";
}
