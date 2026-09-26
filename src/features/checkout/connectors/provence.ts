import { createHash } from "node:crypto";
import { z } from "zod";
import { CheckoutError } from "@/features/checkout/errors";
import type { CreateCheckoutInput } from "@/features/checkout/contracts";
import type { ProductFixture } from "@/features/checkout/demo/fixtures";

export const PROVENCE_NAME = "Lumière de Provence";
export const PROVENCE_DEFAULT_SKU = "01HC075";
export function provenceId(kind: string, value: string) {
  const hex = createHash("sha256").update(`shopperzero:provence:${kind}:${value}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; hex[16] = "8";
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
export const PROVENCE_STORE_ID = provenceId("store", "us");
export class ProvenceRejection extends CheckoutError {
  constructor(public readonly reason: string, message: string) { super("upstream_error", message, 502); }
}
const feedSchema = z.object({ products: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().url(), image: z.string().url(),
  variants: z.array(z.object({ sku: z.string(), title: z.string(), price: z.string().regex(/^\d+\.\d{2}$/), currency: z.literal("USD"), stock: z.number().int().nonnegative(), url: z.string().url() })) })) });
const shopifyFeedSchema = z.object({ products: z.array(z.object({
  handle: z.string().regex(/^[a-z0-9-]+$/), title: z.string(),
  images: z.array(z.object({ src: z.string().url() })).min(1),
  variants: z.array(z.object({ sku: z.string().min(1), title: z.string(), price: z.string().regex(/^\d+\.\d{2}$/) })),
})) });
const variationSchema = z.object({ product: z.object({
  id: z.string(), masterId: z.string().min(1), stock: z.number().int().nonnegative(),
  price: z.object({ sales: z.object({ currency: z.literal("USD"), value: z.number().finite().nonnegative() }) }),
}) });
export interface NativeQuote {
  cart: { lines: { sku: string; qty: number; unitPrice: number }[] };
  subtotal_minor: number; shipping: number; tax: number; total: number; total_minor: number;
  shipping_method: string; shipping_options: { id: string; title: string; amount: number }[]; unavailable: string[];
}
export interface ProvenceOrder {
  id: string; checkout_id: string; payment_reference: string; total: number; status: "placed" | "canceled";
  cart: { lines: { sku: string; qty: number; unitPrice: number }[] }; url?: string;
}
const DW = "/on/demandware.store/Sites-LDP_US-Site/en_US";

/** This adapter only talks to the explicitly configured local demonstration storefront. */
export class ProvenceConnector {
  readonly origin: string;
  constructor(origin: string) {
    const url = new URL(origin);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") {
      throw new CheckoutError("validation_error", "Lumière must use a local storefront origin.");
    }
    this.origin = url.origin;
  }
  async request<T>(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}): Promise<{ data: T; cookie: string }> {
    let response: Response;
    try {
      response = await fetch(this.origin + path, { method: options.method ?? "GET", redirect: "error", cache: "no-store",
        headers: { accept: "application/json", "user-agent": "ShopperZero/1.0", "content-type": "application/json", ...(options.cookie ? { cookie: options.cookie } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: AbortSignal.timeout(2000) });
    } catch { throw new CheckoutError("upstream_error", "Lumière is unavailable. Try again.", 503); }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (data?.error?.code) throw new ProvenceRejection(data.error.code, data.error.message);
      throw new CheckoutError("upstream_blocked", "The storefront blocked checkout.", 502);
    }
    if (!data) throw new CheckoutError("upstream_error", "Lumière returned an invalid response.", 502);
    return { data: data as T, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? options.cookie ?? "" };
  }
  async catalog(): Promise<ProductFixture[]> {
    const { data } = await this.request<unknown>("/products.json");
    const parsed = feedSchema.safeParse(data);
    if (!parsed.success) {
      const shopify = shopifyFeedSchema.safeParse(data);
      if (!shopify.success) throw new CheckoutError("upstream_error", "Lumière’s catalog is unavailable.", 502);
      // The public Shopify feed omits currency and stock counts. Read both from
      // the merchant's SFCC controller; keep identities based on its master/SKU.
      return Promise.all(shopify.data.products.flatMap(p => p.variants.map(async v => {
        const response = await this.request<unknown>(`${DW}/Product-Variation?pid=${encodeURIComponent(v.sku)}`);
        const result = variationSchema.safeParse(response.data);
        if (!result.success || result.data.product.id !== v.sku) {
          throw new CheckoutError("upstream_error", "Lumière returned invalid variant details.", 502);
        }
        const native = result.data.product;
        const price = Math.round(native.price.sales.value * 100);
        if (!Number.isSafeInteger(price)) throw new CheckoutError("upstream_error", "Lumière returned an invalid price.", 502);
        return { id: provenceId("variant", v.sku), product_id: provenceId("product", native.masterId),
          external_id: v.sku, store_id: PROVENCE_STORE_ID, title: p.title, variant_title: v.title, price, stock: native.stock,
          domain: new URL(this.origin).host,
          url: `${this.origin}/en-us/${p.handle}/${encodeURIComponent(native.masterId)}.html?pid=${encodeURIComponent(v.sku)}`,
          image_url: this.origin + new URL(p.images[0].src).pathname, allowlisted: true };
      })));
    }
    return parsed.data.products.flatMap(p => p.variants.map(v => ({ id: provenceId("variant", v.sku), product_id: provenceId("product", p.id),
      external_id: v.sku, store_id: PROVENCE_STORE_ID, title: p.title, variant_title: v.title, price: Number(v.price.replace(".", "")), stock: v.stock,
      domain: new URL(this.origin).host, url: this.origin + new URL(v.url).pathname + new URL(v.url).search,
      image_url: this.origin + new URL(p.image).pathname, allowlisted: true })));
  }
  async quote(input: CreateCheckoutInput, products: ProductFixture[], method = "standard", priceDelta = 0) {
    let { cookie } = await this.request(`${DW}/Cart-Show`);
    for (const line of input.line_items) {
      const product = products.find(p => p.id === line.variant_id)!;
      const added = await this.request<{ addedSku: string }>(`${DW}/Cart-AddProduct`, { method: "POST", cookie, body: { pid: product.external_id, quantity: line.quantity } });
      cookie = added.cookie;
      if (added.data.addedSku !== product.external_id) throw new ProvenceRejection("variant_mismatch", "The store added a different size.");
    }
    const address = input.fulfillment!.address;
    const names = address.name.split(/\s+/);
    const { data } = await this.request<NativeQuote>("/en-us/checkout/shipping", { method: "POST", cookie,
      body: { email: input.buyer!.email, firstName: names[0], lastName: names.slice(1).join(" "), address1: address.line1,
        city: address.city, state: address.region, postalCode: address.postal_code, method, price_delta: priceDelta } });
    if (!Number.isSafeInteger(data.total_minor) || data.total_minor < 0 || data.cart?.lines.length !== input.line_items.length || input.line_items.some(l => {
      const sku = products.find(p => p.id === l.variant_id)!.external_id;
      return !data.cart.lines.some(item => item.sku === sku && item.qty === l.quantity);
    })) throw new ProvenceRejection("cart_mismatch", "The store returned a different cart.");
    return { quote: data, cookie };
  }
  async findOrder(checkoutId: string) {
    const { data } = await this.request<{ orders: ProvenceOrder[] }>(`/__demo/orders?checkout_id=${encodeURIComponent(checkoutId)}`);
    return data.orders[0] ?? null;
  }
  async placeOrder(checkoutId: string, reference: string, total: number, cookie: string) {
    return (await this.request<ProvenceOrder>("/en-us/checkout/place-order", { method: "POST", cookie,
      body: { checkout_id: checkoutId, payment_reference: reference, expected_total: total } })).data;
  }
  async cancelOrder(id: string, checkoutId: string) {
    return (await this.request<ProvenceOrder>(`/__demo/orders/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { checkout_id: checkoutId } })).data;
  }
  orderUrl(id: string) { return `${this.origin}/en-us/order-confirmation?order_id=${encodeURIComponent(id)}`; }
}
