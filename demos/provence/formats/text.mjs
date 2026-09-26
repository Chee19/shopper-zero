// Text helpers. Ported verbatim from spec 03 §6 so the demo store's serializers
// normalise exactly the way WS3's do.

export const stripHtml = h => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();

export const truncate = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

export const escapeHtml = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Our catalogue stores plain text, so this is the description as-is. */
export const plainDescription = p => p.description ?? '';

export const isAvailable = v => v.stock > 0;

/**
 * Full HTML escaping for attribute and text interpolation in pages.mjs.
 * escapeHtml above follows the spec's serializer helper, which does not touch quotes.
 */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
