import "server-only";
import * as cheerio from "cheerio";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema.org JSON-LD is untyped
export type JsonLdNode = Record<string, any>;

export const arr = <T,>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const SCHEMA_PREFIX = /^(?:https?:)?\/\/schema\.org\/|^schema:/i;
export const typesOf = (n: unknown): string[] =>
  n && typeof n === "object" ? arr((n as JsonLdNode)["@type"]).map((t) => String(t).replace(SCHEMA_PREFIX, "")) : [];
export const isType = (n: unknown, ...types: string[]) => typesOf(n).some((t) => types.includes(t));

// Tolerates HTML comment/CDATA wrappers, trailing commas, raw control chars and concatenated objects.
export function safeJson(text: string): unknown {
  const t = text.replace(/^\s*(?:<!--|\/\/\s*<!\[CDATA\[)/, "").replace(/(?:-->|\/\/\s*\]\]>)\s*$/, "").trim().replace(/;\s*$/, "");
  for (const cand of [t, t.replace(/[\u0000-\u001F]+/g, " ").replace(/,\s*([}\]])/g, "$1")]) {
    try {
      return JSON.parse(cand);
    } catch {}
  }
  try {
    return JSON.parse(`[${t.replace(/}\s*{/g, "},{")}]`);
  } catch {
    return null;
  }
}

// Flattens arrays, @graph, mainEntity and ItemList elements; hasVariant/offers stay nested.
export function parseJsonLdNodes(html: string | cheerio.CheerioAPI): JsonLdNode[] {
  const $ = typeof html === "string" ? cheerio.load(html) : html;
  const out: JsonLdNode[] = [];
  const walk = (v: unknown) => {
    for (const n of arr(v as JsonLdNode | JsonLdNode[])) {
      if (!n || typeof n !== "object") continue;
      out.push(n);
      if (n["@graph"]) walk(n["@graph"]);
      if (n.mainEntity) walk(n.mainEntity);
      if (n.itemListElement) walk(arr(n.itemListElement).map((e: JsonLdNode) => e?.item ?? e));
    }
  };
  $('script[type*="ld+json" i]').each((_, el) => walk(safeJson($(el).text() ?? "")));
  return out;
}
