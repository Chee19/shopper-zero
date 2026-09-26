import "server-only";

// Stop-before-payment rules shared by the dom and computer_use probes (02 section 6.6).
export const PAY_RE = /\b(place (your )?order|pay( now)?|complete (order|purchase|payment)|confirm (order|purchase|and pay)|submit order|buy now|purchase now|express checkout|pay with|apple pay|google pay|paypal|shop pay|klarna|afterpay)\b/i;
export const PAYMENT_IFRAME_RE = /stripe|braintree|adyen|paypal|klarna|afterpay|checkout\.com|squareup|authorize\.net|shopifycs|pay\.shopify/i;
export const PAYMENT_FIELD_RE = /card|cc-?(num|number|exp|csc)|cvc|cvv|expir|iban|account.?number|password|passwd/i;
export const CHECKOUT_URL_RE = /\/(checkout|checkouts|order-pay|payment|onepage)(\/|\?|$)|checkout\.shopify\.com|action=checkout/i;
