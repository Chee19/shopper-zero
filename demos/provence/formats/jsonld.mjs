// schema.org ProductGroup for product pages, written to be parsed by spec 02 §5.7's engine.
//
// Choices that matter to that parser:
//  - the group's `url` canonicalizes to the page URL, so §5.7 rule 6 picks it as the main
//    entity rather than falling back to "the first group";
//  - each hasVariant is a Product node with `inProductGroupWithID` AND is reachable through
//    hasVariant, so variant grouping resolves whichever way the parser goes (rule 6);
//  - availability uses the full schema.org URL, whose last path segment §5.7 rule 7 maps;
//  - price is a decimal string with a lone `.`, which is what parsePrice expects.
//
// ProductGroup is emitted uniformly, including for the four single-variant products:
// §5.7 handles a group with one hasVariant, and one shape per PDP keeps this simple.

import { BRAND, SHIPPING, productPath } from '../catalog.mjs';
import { inStock } from '../stock.mjs';
import { ORIGIN, productImages } from '../config.mjs';

const shippingDetails = {
  '@type': 'OfferShippingDetails',
  shippingRate: { '@type': 'MonetaryAmount', value: SHIPPING.standard, currency: BRAND.currency },
  shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
  deliveryTime: {
    '@type': 'ShippingDeliveryTime',
    handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
    transitTime: { '@type': 'QuantitativeValue', minValue: 3, maxValue: 5, unitCode: 'DAY' },
  },
};

const returnPolicy = {
  '@type': 'MerchantReturnPolicy',
  applicableCountry: 'US',
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: SHIPPING.returnDays,
  returnFees: 'https://schema.org/FreeReturn',
  returnMethod: 'https://schema.org/ReturnByMail',
};

export function productJsonLd(p) {
  const image = productImages(p)[0]?.url;
  return {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: p.name,
    description: p.summary,
    productGroupID: p.master,
    brand: { '@type': 'Brand', name: BRAND.name },
    url: ORIGIN + productPath(p),
    image,
    variesBy: 'https://schema.org/size',
    aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviews },
    hasVariant: p.variants.map(v => ({
      '@type': 'Product',
      sku: v.sku,
      name: `${p.name} ${v.size}`,
      size: v.size,
      image,
      inProductGroupWithID: p.master,
      offers: {
        '@type': 'Offer',
        url: `${ORIGIN}${productPath(p)}?pid=${v.sku}`,
        price: v.price.toFixed(2),
        priceCurrency: BRAND.currency,
        availability: inStock(v) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        shippingDetails,
        hasMerchantReturnPolicy: returnPolicy,
      },
    })),
  };
}
