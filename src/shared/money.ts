// src/shared/money.ts
// Isomorphic (server + client). All money in the app is integer minor units.
import type { Money } from "@/contracts";

const exponentCache = new Map<string, number>();

/** Number of minor-unit digits: USD 2, JPY 0, KWD 3. Unknown codes fall back to 2. */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  const hit = exponentCache.get(code);
  if (hit !== undefined) return hit;
  let exp = 2;
  try {
    exp = new Intl.NumberFormat("en", { style: "currency", currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    exp = 2;
  }
  exponentCache.set(code, exp);
  return exp;
}

/** Builds a Money, validating integer amount and upper-casing the currency. Throws on bad input. */
export function money(amount: number, currency: string): Money {
  if (!Number.isSafeInteger(amount)) throw new Error(`money: amount must be an integer, got ${amount}`);
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`money: bad currency ${currency}`);
  return { amount, currency: code };
}

/**
 * Strict decimal -> minor units. Accepts "25", "25.5", "25.50", "-3.10", 25.5.
 * Extra fraction digits are rounded half-up ("1.005" USD -> 101). Throws on anything else.
 */
export function toMinor(value: string | number, currency: string): number {
  const exp = currencyExponent(currency);
  const s = typeof value === "number" ? numberToPlain(value) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`toMinor: not a decimal: ${JSON.stringify(value)}`);
  const [, neg, int, frac = ""] = m;
  const kept = (frac + "0".repeat(exp)).slice(0, exp);
  let minor = Number(int) * 10 ** exp + (kept ? Number(kept) : 0);
  if (frac.length > exp && Number(frac[exp]) >= 5) minor += 1; // half-up on the first dropped digit
  return neg ? -minor : minor;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`toMinor: not finite: ${n}`);
  // Avoid exponent notation; 12 fraction digits is plenty for prices.
  return n.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Lenient price parser for scraped text/JSON-LD. Returns null when nothing parseable.
 * "£1,299.00" -> 129900 (GBP) · "1.299,00 €" -> 129900 (EUR) · "25,50" -> 2550 · "1,299" -> 129900 ·
 * " $45 " -> 4500 · 19.99 -> 1999 · "" / "Call us" / null -> null.
 */
export function parsePrice(raw: unknown, currency: string): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? toMinor(raw, currency) : null;
  if (typeof raw !== "string") return null;
  // First price only ("Sale price$25.00Regular price$30.00" -> "$25.00"). Space/apostrophe-grouped
  // thousands are matched first: "1 299,00 €", "CHF 1'299.00", "12 500 Kč".
  const m = raw.match(/\d{1,3}(?:[ \u00a0\u202f'\u2019]\d{3})+(?:[.,]\d+)?|\d[\d.,]*/);
  if (!m) return null;
  const before = raw.slice(0, m.index);
  if (/[-\u2212][^\w]*$/.test(before)) return null; // negatives: "-5", "-$5", "- $5", "−$5", "$-5"
  // Drop separators that belong to text, not the number ("Rs. 1,299.00", "45.00.").
  let s = m[0].replace(/[ \u00a0\u202f'\u2019]/g, "").replace(/[.,]+$/, "");
  // A separator right before the digits that isn't an abbreviation dot is a decimal point: "$.99", ".99".
  if (/[.,]$/.test(before) && !/\p{L}[.,]$/u.test(before)) {
    if (!/^\d+$/.test(s)) return null;
    s = `0.${s}`;
  }
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the right-most one is the decimal separator.
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    // Only commas: decimal iff exactly one comma followed by 1-2 digits at the end.
    const parts = s.split(",");
    s = parts.length === 2 && /^\d{1,2}$/.test(parts[1]) ? `${parts[0]}.${parts[1]}` : parts.join("");
  } else if (lastDot >= 0) {
    // Only dots: several dots = thousands separators ("1.299.000").
    const parts = s.split(".");
    if (parts.length > 2) {
      if (!parts.slice(1).every((g) => /^\d{3}$/.test(g))) return null;
      s = parts.join("");
    }
  }
  try {
    const v = toMinor(s, currency);
    return v;
  } catch {
    return null;
  }
}

/** Re-scales an integer minor amount from a source exponent (e.g. Woo currency_minor_unit) to the currency's exponent. */
export function rescaleMinor(amount: number | string, fromExponent: number, currency: string): number {
  const n = typeof amount === "string" ? (amount.trim() === "" ? NaN : Number(amount)) : amount;
  if (!Number.isFinite(n)) throw new Error(`rescaleMinor: bad amount ${amount}`);
  const diff = currencyExponent(currency) - fromExponent;
  return diff >= 0 ? Math.round(n * 10 ** diff) : Math.round(n / 10 ** -diff);
}

/** Minor units -> plain decimal string with exactly `exponent` digits: (2500,"USD") -> "25.00"; (500,"JPY") -> "500". */
export function fromMinor(amount: number, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = amount < 0;
  const abs = Math.abs(Math.trunc(amount)).toString().padStart(exp + 1, "0");
  const out = exp === 0 ? abs : `${abs.slice(0, -exp)}.${abs.slice(-exp)}`;
  return neg ? `-${out}` : out;
}

/** Display string: ({4500,"USD"}) -> "$45.00". */
export function formatMoney(m: Money, locale = "en-US"): string {
  const exp = currencyExponent(m.currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency })
    .format(m.amount / 10 ** exp);
}

/** ACP feed price: "25.00 USD". */
export function acpPrice(m: Money): string {
  return `${fromMinor(m.amount, m.currency)} ${m.currency}`;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`currency mismatch ${a.currency}/${b.currency}`);
  return money(a.amount + b.amount, a.currency);
}

export function multiplyMoney(m: Money, qty: number): Money {
  if (!Number.isInteger(qty)) throw new Error("multiplyMoney: qty must be an integer");
  return money(m.amount * qty, m.currency);
}

export function sumMoney(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), money(0, currency));
}
