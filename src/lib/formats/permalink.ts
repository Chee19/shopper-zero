// src/lib/formats/permalink.ts  (WS3; pure. WS4's handoff connector may import it.)
import type { Platform } from "@/lib/contracts";

const num = (s: string | null | undefined) => (s && /^\d+$/.test(s) ? s : null);

/**
 * Merchant add-to-cart link (or the PDP when the platform has no cart permalink), tagged with UTM.
 * The origin comes from the product URL: Store.domain has no "www." and may carry a locale path.
 * Woo ids follow B9: variant.external_id = Store API purchasable id, product.external_id = Woo product id.
 */
export function cartPermalink(
  store: { platform: Platform },
  p: { url: string; external_id: string | null },
  v: { external_id: string | null; offer: { url: string | null } },
  qty = 1,
): string {
  const origin = new URL(p.url).origin;
  const vid = num(v.external_id);
  const pid = num(p.external_id);
  const utm = (u: string) => `${u}${u.includes("?") ? "&" : "?"}utm_source=shoperzero&utm_medium=agent`;
  switch (store.platform) {
    case "woocommerce": {
      const id = vid ?? pid; // UNVERIFIED for variations on every Woo version; PDP fallback below
      if (id) return utm(`${origin}/?add-to-cart=${id}&quantity=${qty}`);
      break;
    }
    case "bigcommerce":
      if (pid) return utm(`${origin}/cart.php?action=add&product_id=${pid}&qty=${qty}`);
      break;
    case "shopify":
      if (vid) return utm(`${origin}/cart/${vid}:${qty}`);
      break;
  }
  return utm(v.offer.url ?? p.url);
}
