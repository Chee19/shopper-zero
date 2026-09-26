// Money. The specs carry prices as integer ISO 4217 minor units
// ({ amount: 2500, currency: "USD" } is $25.00); catalog.mjs carries dollars, because
// that is merchant data. Conversion happens here, at the serializer boundary, and
// nowhere else.

import { BRAND } from '../catalog.mjs';

/** Dollars → minor units. */
export const toMinor = (value, currency = BRAND.currency) =>
  ({ amount: Math.round(value * 100), currency });

/** Minor units → Shopify's decimal string form: "25.00". */
export const fromMinor = m => (m.amount / 100).toFixed(2);

/** ACP's price form: "25.00 USD". */
export const acpPrice = m => `${fromMinor(m)} ${m.currency}`;

/** Display form for llms.txt and HTML: "$25.00". */
export const formatMoney = m => `$${fromMinor(m)}`;

/** Convenience for pages: dollars → "$25.00". */
export const money = n => formatMoney(toMinor(n));
