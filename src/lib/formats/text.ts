// src/lib/formats/text.ts  (WS3; pure, isomorphic)
import type { IndexedProduct, IndexedVariant } from "@/lib/contracts";

const codePoint = (n: number, fallback: string) => {
  try {
    return String.fromCodePoint(n);
  } catch {
    return fallback;
  }
};

export const stripHtml = (h: string) =>
  h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (m, d: string) => codePoint(Number(d), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => codePoint(Number.parseInt(h, 16), m))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();

export const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

export const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const plainDescription = (p: Pick<IndexedProduct, "description_text" | "description_html">) =>
  p.description_text ?? (p.description_html ? stripHtml(p.description_html) : "");

export const isAvailable = (v: Pick<IndexedVariant, "offer">) =>
  v.offer.availability === "in_stock" || v.offer.availability === "preorder";

/** One line of plain text: control characters (incl. C1/NEL) and all whitespace runs become one space. */
const plainLine = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();

/** Third-party text in plain-text MCP summaries: one line, bounded, no Markdown escaping. */
export const plainInline = (s: string, max = 120) => truncate(plainLine(s), max);

/**
 * Third-party text (store names, product titles) placed inline in Markdown (llms.txt) or MCP summaries:
 * one line, no link/code syntax, no leading block markers, bounded length. Stops a crawled page from
 * injecting headings, fake links or "rules" into our agent-facing files.
 */
export const mdInline = (s: string, max = 150) =>
  truncate(
    plainLine(s)
      .replace(/[\\`*_[\]()<>|]/g, (c) => `\\${c}`)
      .replace(/^([#>+-])/, "\\$1"),
    max,
  );
