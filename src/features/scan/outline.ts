import "server-only";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { DomRecipe } from "@/contracts";
import { parsePrice } from "@/shared/money";
import { PAYMENT_FIELD_RE } from "./guard";

export type PageKind = "home" | "listing" | "pdp" | "cart";
export interface Page { kind: PageKind; url: string; $: CheerioAPI }
export type Pages = Partial<Record<PageKind, Page>>;

// ---------- outline builder (02 section 6.5 stage B step 2) ----------

const DROP = new Set(["head", "script", "style", "svg", "noscript", "iframe", "template"]);
const KEEP = new Set(["a", "button", "input", "select", "option", "form", "label", "h1", "h2", "h3"]);
const KEYWORD = /price|cart|basket|bag|search|product|variant|option|swatch|size|colou?r|add|buy|checkout|qty|quantity/i;
const ATTRS = ["name", "type", "role", "itemprop", "href", "action", "aria-label"];
const MAX_DEPTH = 8;
const MAX_CHARS = 12_000;

interface Block { sig: string; lines: string[] }

export const squash = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
};
const indent = (depth: number) => "  ".repeat(Math.min(depth, MAX_DEPTH));
const pathHead = (href: string) => href.replace(/^[a-z][\w+.-]*:\/\/[^/]+/i, "").split(/[/?#]/).find(Boolean) ?? "";

function isKept(el: Element): boolean {
  const a = el.attribs;
  if (KEEP.has(el.name) || a.role !== undefined || a.itemprop !== undefined) return true;
  return Object.entries(a).some(([k, v]) =>
    k === "id" || k === "class" || k === "name" ? KEYWORD.test(v) : k.startsWith("data-") && KEYWORD.test(`${k}=${v.slice(0, 200)}`));
}

function textOf(n: AnyNode, deep: boolean): string {
  if (n.nodeType === 3) return n.data;
  if (!("attribs" in n) || DROP.has(n.name)) return "";
  return n.children.map((c) => (c.nodeType === 3 ? c.data : deep ? textOf(c, true) : "")).join(" ");
}

function describe(el: Element): string {
  const a = el.attribs;
  const id = a.id ? `#${a.id.slice(0, 40)}` : "";
  const cls = (a.class ?? "").split(/\s+/).filter((c) => c && c.length <= 40).slice(0, 4).map((c) => `.${c}`).join("");
  const data = Object.keys(a).filter((k) => k.startsWith("data-"))
    .sort((x, y) => Number(KEYWORD.test(y)) - Number(KEYWORD.test(x))).slice(0, 3);
  const attrs = [...ATTRS, ...data].filter((k) => a[k] !== undefined)
    .map((k) => `[${k}=${squash(a[k], k === "href" || k === "action" ? 80 : 40)}]`).join("");
  return `${el.name}${id}${cls}${attrs}`;
}

// Same tag and classes (plus the first href segment for links) repeat as product grids, menus and option lists.
const signature = (el: Element) => `${el.name}.${el.attribs.class ?? ""}${el.name === "a" ? ` ${pathHead(el.attribs.href ?? "")}` : ""}`;

function collapse(blocks: Block[], depth: number): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks.length;) {
    let j = i;
    while (j < blocks.length && blocks[j].sig === blocks[i].sig) j++;
    const limit = blocks[i].sig === "option." ? 5 : 3;
    out.push(...blocks.slice(i, Math.min(j, i + limit)));
    if (j - i > limit) out.push({ sig: "", lines: [`${indent(depth)}... x${j - i}`] });
    i = j;
  }
  return out;
}

function walk(el: Element, depth: number, skip: Set<AnyNode>): Block[] {
  const kept = isKept(el);
  const childDepth = kept ? depth + 1 : depth;
  const kids: Block[] = [];
  for (const c of el.children) if ("attribs" in c && !DROP.has(c.name) && !skip.has(c)) kids.push(...walk(c, childDepth, skip));
  const blocks = collapse(kids, childDepth);
  if (!kept) return blocks;
  // Leaves carry their full text; containers only their own, since their kept children print theirs.
  const text = squash(textOf(el, blocks.length === 0), 60);
  const line = `${indent(depth)}${describe(el)}${text ? ` "${text}"` : ""}`;
  return [{ sig: signature(el), lines: [line, ...blocks.flatMap((b) => b.lines)] }];
}

// Site chrome repeats on every page and can push a product page's add-to-cart past the cap, so only the home outline keeps it.
const CHROME = "header, footer, nav, [role=banner], [role=navigation], [role=contentinfo]";

export function buildOutline($: CheerioAPI, keepChrome = true): string {
  const lines = [`title "${squash($("title").first().text(), 60)}"`];
  const body = $("body").get(0);
  const skip = new Set<AnyNode>(keepChrome ? [] : $(CHROME).toArray());
  if (body) for (const b of walk(body, 0, skip)) lines.push(...b.lines);
  let out = "";
  for (const line of lines) {
    if (out.length + line.length + 1 > MAX_CHARS) break;
    out += `${line}\n`;
  }
  return out;
}

// ---------- selector validation (step 4) ----------

export const RECIPE_FIELDS = [
  "search_input", "product_card", "product_link", "title", "price", "variant_picker", "add_to_cart", "cart_link", "checkout_link",
] as const;
export type RecipeField = (typeof RECIPE_FIELDS)[number];

const FIELD_PAGES: Record<RecipeField, PageKind[]> = {
  search_input: ["home"], product_card: ["listing", "home"], product_link: ["listing", "home"],
  title: ["pdp"], price: ["pdp"], variant_picker: ["pdp"], add_to_cart: ["pdp"], cart_link: ["home"], checkout_link: ["cart"],
};
// cheerio accepts jQuery pseudo-classes that document.querySelector rejects, and recipes are meant for real browsers.
const JQUERY_ONLY = /:(contains|icontains|eq|gt|lt|first|last|even|odd|header|parent|input|button|text|checkbox|radio|submit|selected|image|reset|file|password)(?![\w-])/i;

export function select($: CheerioAPI, sel: string): Cheerio<AnyNode> | null {
  try {
    return $(sel);
  } catch {
    return null;
  }
}

export function readPrice($: CheerioAPI, sel: string, currency: string): { text: string; amount: number } | null {
  for (const el of select($, sel)?.slice(0, 3).toArray() ?? []) {
    const text = squash($(el).text(), 60) || ($(el).attr("content") ?? "").trim();
    const amount = parsePrice(text, currency);
    if (amount != null && amount > 0) return { text, amount };
  }
  return null;
}

// Themes name product tiles "card", so that word only counts as a payment hint outside the product card and link.
const isPaymentSelector = (f: RecipeField, sel: string) =>
  PAYMENT_FIELD_RE.test(f === "product_card" || f === "product_link" ? sel.replace(/card/gi, "") : sel);

export function validateRecipe(
  raw: Record<RecipeField, string | null> & { notes: string }, pages: Pages, currency: string,
): { recipe: DomRecipe; valid: RecipeField[] } {
  const recipe: DomRecipe = { notes: raw.notes };
  const valid: RecipeField[] = [];
  for (const f of RECIPE_FIELDS) {
    const sel = raw[f]?.trim();
    if (!sel || JQUERY_ONLY.test(sel) || isPaymentSelector(f, sel)) continue;
    const hit = FIELD_PAGES[f].some((kind) => {
      const p = pages[kind];
      if (!p) return false;
      return f === "price" ? readPrice(p.$, sel, currency) != null : (select(p.$, sel)?.length ?? 0) > 0;
    });
    if (hit) {
      recipe[f] = sel;
      valid.push(f);
    }
  }
  return { recipe, valid };
}
