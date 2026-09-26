import type { Money, ReadinessGrade } from "./contracts";

export type Tone = "good" | "good2" | "warn" | "serious" | "bad" | "accent" | "muted";

function currencyFormatter(currency: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency });
  } catch {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  }
}

/** Minor units → display string, using the currency's own fraction digits (4200 USD → $42.00, 4200 JPY → ¥4,200). */
export function formatMoney(m: Money | null | undefined): string {
  if (!m) return "—";
  const f = currencyFormatter(m.currency);
  const digits = f.resolvedOptions().maximumFractionDigits ?? 2;
  return f.format(m.amount / 10 ** digits);
}

export function formatMinor(amount: number, currency: string): string {
  return formatMoney({ amount, currency });
}

export function formatRange(r: { min: Money; max: Money } | null | undefined): string {
  if (!r) return "—";
  if (r.min.amount === r.max.amount) return formatMoney(r.min);
  return `${formatMoney(r.min)} – ${formatMoney(r.max)}`;
}

/** ≈1 s, ≈8 s, ≈90 s, ≈2.5 min (minutes only past 2 min, so the "≈90 s" headline reads as in DECISIONS §A). */
export function formatSeconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  if (s < 120) return `≈${s < 10 ? Math.max(1, Math.round(s * 10) / 10) : Math.round(s)} s`;
  const min = Math.round((s / 60) * 10) / 10;
  return `≈${min} min`;
}

/** Always 2 decimals; < $0.01 (but > 0) shows <$0.01. */
export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/** m:ss */
export function elapsed(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "3 min ago". `now` is passed in so render stays pure. */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.replace(/-/g, "").slice(0, 8);
}

export function gradeTone(grade: ReadinessGrade | null | undefined): Tone {
  switch (grade) {
    case "A": return "good";
    case "B": return "good2";
    case "C": return "warn";
    case "D": return "serious";
    case "F": return "bad";
    default: return "muted";
  }
}

export function domainOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** UNVERIFIED for sandboxes; the id is always shown with copy. */
export function stripeUrl(pi: string): string {
  return `https://dashboard.stripe.com/test/payments/${pi}`;
}

export function truncateMiddle(s: string, head = 6, tail = 4): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "—";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join("");
}
