// src/lib/formats/text.ts  (WS3; pure, isomorphic)
import type { IndexedProduct, IndexedVariant } from "@/lib/contracts";

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
