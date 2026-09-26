// Catalogue for the Lumière de Provence demo store.
// Fictional brand and original copy; structure mirrors a Salesforce Commerce Cloud
// beauty storefront (master product + size variants, SKU-suffixed URLs).

export const BRAND = {
  name: 'Lumière de Provence',
  short: 'LUMIÈRE',
  tagline: 'Provençal skincare, since 1981',
  siteId: 'Sites-LDP_US-Site',
  locale: 'en_US',
  currency: 'USD',
};

export const SHIPPING = {
  freeThreshold: 65,
  standard: 6.95,
  express: 14.95,
  standardDays: '3–5 business days',
  expressDays: '1–2 business days',
  returnDays: 30,
};

export const CATEGORIES = [
  { id: 'face', name: 'Face', blurb: 'Serums, creams and mists built around flowers from the Luberon.' },
  { id: 'body', name: 'Body', blurb: 'Shower oils, lotions and rich creams for every season.' },
  { id: 'hands', name: 'Hands', blurb: 'Our cult hand creams, in sizes for every bag.' },
  { id: 'fragrance', name: 'Fragrance', blurb: 'Fresh, herbal scents bottled in Grasse.' },
  { id: 'hair', name: 'Hair', blurb: 'Plant-based care for every hair type.' },
  { id: 'gifts', name: 'Gifts', blurb: 'Ready-wrapped sets, from stocking fillers to grand gestures.' },
];

// art: shape + colours used to draw the product illustration (no photography).
export const PRODUCTS = [
  {
    id: 'shea-hand-cream', master: '01HC150', category: 'hands', bestseller: true,
    name: 'Shea Butter Hand Cream',
    kicker: 'Our #1 hand cream',
    summary: 'A rich, fast-absorbing hand cream with 20% shea butter for dry, hard-working hands.',
    description: 'Made with shea butter sourced through a women-led cooperative in Burkina Faso, this dense cream melts into skin without leaving hands greasy. Keep the small tube in a coat pocket and the large one by the sink.',
    ingredients: 'Butyrospermum Parkii (Shea) Butter 20%, Glycerin, Sweet Almond Oil, Honey Extract, Coconut Oil.',
    howTo: 'Warm a pea-sized amount between palms and massage in, paying attention to knuckles and cuticles.',
    rating: 4.8, reviews: 2143,
    art: { shape: 'tube', body: '#f4d23c', cap: '#5b4a1f' },
    variants: [
      { sku: '01HC030', size: '30 ml', price: 12, stock: 184 },
      { sku: '01HC075', size: '75 ml', price: 24, stock: 96 },
      { sku: '01HC150', size: '150 ml', price: 38, stock: 41 },
    ],
  },
  {
    id: 'almond-shower-oil', master: '02SO250', category: 'body', bestseller: true,
    name: 'Almond Shower Oil',
    kicker: 'Turns to a milky foam',
    summary: 'A cleansing oil that becomes a soft foam under water and leaves skin supple.',
    description: 'Sweet almond oil from Provençal orchards cleanses gently while it nourishes, so skin feels comfortable straight out of the shower. The warm almond scent lingers softly.',
    ingredients: 'Glycine Soja Oil, Laureth-4, Prunus Amygdalus Dulcis (Sweet Almond) Oil, Parfum, Tocopherol.',
    howTo: 'Apply to damp skin, work into a foam and rinse.',
    rating: 4.7, reviews: 1388,
    art: { shape: 'bottle', body: '#e9c79a', cap: '#8a5a2b' },
    variants: [
      { sku: '02SO075', size: '75 ml', price: 12, stock: 60 },
      { sku: '02SO250', size: '250 ml', price: 28, stock: 132 },
      { sku: '02SO500', size: '500 ml', price: 48, stock: 22 },
    ],
  },
  {
    id: 'everlasting-renewal-serum', master: '03RS030', category: 'face', bestseller: true,
    name: 'Everlasting Flower Renewal Serum',
    kicker: 'Visible radiance in 7 days',
    summary: 'A lightweight serum with everlasting-flower essential oil to smooth and brighten.',
    description: 'Everlasting flower grows wild on the hillsides of Corsica and keeps its colour long after it is picked. We distil it into an essential oil and pair it with plant peptides in a silky, fast-absorbing serum.',
    ingredients: 'Aqua, Glycerin, Helichrysum Italicum Flower Oil, Plant Peptides, Sodium Hyaluronate.',
    howTo: 'Morning and evening, press 2–3 drops into clean skin before moisturiser.',
    rating: 4.6, reviews: 874,
    art: { shape: 'dropper', body: '#c9772b', cap: '#f2e2c4' },
    variants: [
      { sku: '03RS030', size: '30 ml', price: 78, stock: 35 },
      { sku: '03RS050', size: '50 ml', price: 108, stock: 12 },
    ],
  },
  {
    id: 'rose-petal-face-mist', master: '04FM050', category: 'face',
    name: 'Rose Petal Face Mist',
    kicker: 'Refresh anytime',
    summary: 'A fine mist of rose water that refreshes and preps skin.',
    description: 'Steam-distilled Damask rose water in a mist fine enough to use over make-up. Spritz after cleansing or whenever skin feels tight.',
    ingredients: 'Rosa Damascena Flower Water, Glycerin, Aloe Barbadensis Leaf Juice.',
    howTo: 'Hold 20 cm from the face, close eyes and mist.',
    rating: 4.5, reviews: 412,
    art: { shape: 'spray', body: '#f1b8c0', cap: '#ffffff' },
    variants: [
      { sku: '04FM050', size: '50 ml', price: 22, stock: 70 },
      { sku: '04FM150', size: '150 ml', price: 42, stock: 0 },
    ],
  },
  {
    id: 'shea-rich-body-cream', master: '05BC200', category: 'body', bestseller: true,
    name: 'Shea Ultra-Rich Body Cream',
    kicker: '48h hydration',
    summary: 'A velvety body cream with 25% shea butter for very dry skin.',
    description: 'Our richest body cream, whipped to a light texture so it spreads easily. A favourite for winter elbows, knees and heels.',
    ingredients: 'Butyrospermum Parkii (Shea) Butter 25%, Aqua, Glycerin, Cetearyl Alcohol, Honey Extract.',
    howTo: 'Massage into clean skin, especially on dry areas.',
    rating: 4.8, reviews: 1621,
    art: { shape: 'jar', body: '#f4d23c', cap: '#ffffff' },
    variants: [
      { sku: '05BC200', size: '200 ml', price: 56, stock: 48 },
    ],
  },
  {
    id: 'verbena-eau-de-toilette', master: '06VE100', category: 'fragrance',
    name: 'Verbena Eau de Toilette',
    kicker: 'Zesty and green',
    summary: 'A sparkling citrus-herbal scent built around lemon verbena from Provence.',
    description: 'Lemon verbena leaves, picked at dawn, give this fragrance its bright opening. Notes of mandarin and a soft woody base keep it fresh from morning to evening.',
    ingredients: 'Alcohol Denat., Aqua, Parfum, Lippia Citriodora Leaf Extract, Citral, Limonene.',
    howTo: 'Spray on pulse points: wrists, neck and behind the ears.',
    rating: 4.6, reviews: 539,
    art: { shape: 'perfume', body: '#a8c46a', cap: '#3f5a22' },
    variants: [
      { sku: '06VE030', size: '30 ml', price: 38, stock: 55 },
      { sku: '06VE100', size: '100 ml', price: 80, stock: 19 },
    ],
  },
  {
    id: 'cherry-blossom-body-lotion', master: '07BL250', category: 'body',
    name: 'Cherry Blossom Body Lotion',
    kicker: 'Light and shimmer-free',
    summary: 'A fluid lotion with a delicate cherry-blossom scent.',
    description: 'A light, non-sticky lotion that absorbs in seconds. The scent is soft and floral, never sugary.',
    ingredients: 'Aqua, Glycerin, Caprylic/Capric Triglyceride, Prunus Cerasus Flower Extract, Parfum.',
    howTo: 'Smooth over the body after showering.',
    rating: 4.4, reviews: 302,
    art: { shape: 'bottle', body: '#f6c6d3', cap: '#b84a6a' },
    variants: [
      { sku: '07BL250', size: '250 ml', price: 42, stock: 64 },
    ],
  },
  {
    id: 'five-herb-repair-shampoo', master: '08SH300', category: 'hair',
    name: 'Five-Herb Repair Shampoo',
    kicker: 'Silicone-free',
    summary: 'A gentle shampoo with five essential oils for dry, damaged hair.',
    description: 'Angelica, lavender, geranium, ylang-ylang and rosemary essential oils cleanse without stripping. Hair feels softer from the first wash.',
    ingredients: 'Aqua, Sodium Laureth Sulfate, Coco-Glucoside, Essential Oil Blend, Glycerin.',
    howTo: 'Massage into wet hair and scalp, then rinse thoroughly.',
    rating: 4.5, reviews: 688,
    art: { shape: 'bottle', body: '#6f8f5b', cap: '#f3ecd9' },
    variants: [
      { sku: '08SH300', size: '300 ml', price: 26, stock: 90 },
      { sku: '08SH500', size: '500 ml', price: 36, stock: 37 },
    ],
  },
  {
    id: 'lavender-pillow-mist', master: '09PM100', category: 'body',
    name: 'Lavender Pillow Mist',
    kicker: 'For a calmer bedtime',
    summary: 'A soothing linen and pillow spray with organic lavender essential oil.',
    description: 'True lavender from the Valensole plateau, with a touch of sweet orange. Mist over pillows and sheets as part of your wind-down routine.',
    ingredients: 'Alcohol Denat., Aqua, Lavandula Angustifolia Oil, Citrus Aurantium Dulcis Oil.',
    howTo: 'Spray twice over pillows from 30 cm before bed.',
    rating: 4.7, reviews: 955,
    art: { shape: 'spray', body: '#9b8bc4', cap: '#ffffff' },
    variants: [
      { sku: '09PM100', size: '100 ml', price: 32, stock: 110 },
    ],
  },
  {
    id: 'hand-cream-discovery-trio', master: '10GT003', category: 'gifts',
    name: 'Hand Cream Discovery Trio',
    kicker: 'Gift-wrapped',
    summary: 'Three 30 ml hand creams: shea, lavender and cherry blossom.',
    description: 'Our best-loved hand creams in travel sizes, presented in a recyclable printed box. An easy gift for anyone who washes their hands a lot.',
    ingredients: 'See individual products.',
    howTo: 'Use throughout the day as needed.',
    rating: 4.9, reviews: 1204,
    art: { shape: 'box', body: '#f4d23c', cap: '#9b8bc4' },
    variants: [
      { sku: '10GT003', size: '3 × 30 ml', price: 36, stock: 150 },
    ],
  },
];

export const productById = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
export const variantBySku = Object.fromEntries(
  PRODUCTS.flatMap(p => p.variants.map(v => [v.sku, { product: p, variant: v }])),
);

export const productPath = p => `/en-us/${p.id}-${p.master}.html`;
export const categoryPath = c => `/en-us/${c.id}/`;
export const fromPrice = p => Math.min(...p.variants.map(v => v.price));
export const inStock = v => v.stock > 0;
