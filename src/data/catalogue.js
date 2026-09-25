// Product data transcribed from the design handoff (screen 1b).
// TODO: Handle core functionality later — replace with GET /api/products once the
// backend models the three order types (kitchen / plan / pantry) and plan pricing.
// Nutrition figures are placeholders per the handoff; only the 23g protein on the
// Chocolate Protein Chia Pudding comes from the real label.

export const PER_MONTH = { Daily: 30, 'Alternate days': 15, 'Twice a week': 8, Weekly: 4 };
export const DURATION_PCT = { 1: 8, 2: 14, 3: 18 };
export const FREE_SHIPPING_AT = 999;

export const PRODUCTS = [
  {
    id: 'chia-choc',
    name: 'Chocolate Protein Chia Pudding',
    type: 'kitchen',
    image: '/assets/products/chia.png',
    price: 349,
    mrp: 399,
    meta: '23g protein · 190 kcal · 200ml jar',
    badge: 'NOW · 30 MIN',
    subscribable: true,
    planUnit: 'jar',
    tags: ['high-protein']
  },
  {
    id: 'smoothie-dragon',
    name: 'Dragonfruit Smoothie',
    type: 'kitchen',
    image: '/assets/products/smoothie.png',
    price: 329,
    meta: '6g protein · 165 kcal · 300ml',
    badge: 'NOW · 30 MIN',
    subscribable: true,
    planUnit: 'bottle',
    tags: []
  },
  {
    id: 'tikki',
    name: 'Sabudana Sweet Potato Tikki',
    type: 'kitchen',
    image: '/assets/products/tikki.png',
    price: 249,
    meta: '8g protein · 230 kcal · 4 pc',
    badge: 'NOW · 45 MIN',
    subscribable: false,
    tags: ['under-300']
  },
  {
    id: 'fries',
    name: 'Peri Peri House Fries',
    type: 'kitchen',
    image: '/assets/products/fries.png',
    price: 229,
    meta: 'Sweet potato · 260 kcal · serves 1',
    badge: 'NOW · 30 MIN',
    subscribable: false,
    tags: ['under-300']
  },
  {
    id: 'dryfruit',
    name: 'Kashmiri Dry Fruits',
    type: 'pantry',
    image: '/assets/products/dryfruit.png',
    price: 899,
    meta: '500g · sourced per order',
    badge: 'SHIPS · 3–5 DAYS',
    shippingNote: 'Free shipping over ₹999',
    subscribable: false,
    sizes: [
      { label: '500g', price: 899 },
      { label: '1kg', price: 1699 }
    ],
    tags: []
  },
  {
    id: 'muesli',
    name: 'Kashmiri Muesli',
    type: 'pantry',
    image: '/assets/products/muesli.png',
    price: 640,
    meta: '400g · no added sugar',
    badge: 'SHIPS · 3–5 DAYS',
    shippingNote: 'Free shipping',
    subscribable: true,
    planUnit: 'pack',
    sizes: [
      { label: '400g', price: 640 },
      { label: '800g', price: 1180 }
    ],
    tags: []
  },
  {
    id: 'modak',
    name: 'Pan Dry Fruit Gulkand Modak',
    type: 'pantry',
    image: '/assets/products/modak.png',
    price: 560,
    meta: '12 pc · gifting box',
    badge: 'SHIPS · 3–5 DAYS',
    shippingNote: 'Made fresh, ships chilled',
    subscribable: false,
    sizes: [
      { label: '12 pc', price: 560 },
      { label: '24 pc', price: 1060 }
    ],
    tags: []
  }
];

// The builder offers these three, in this order (design 2a).
export const SUBSCRIBABLE = ['chia-choc', 'smoothie-dragon', 'muesli']
  .map((id) => PRODUCTS.find((p) => p.id === id))
  .filter(Boolean);

export function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id);
}

/** Plan maths, exactly as specified in the handoff. */
export function planQuote(basePrice, frequency, months) {
  const perMonth = PER_MONTH[frequency] ?? 15;
  const deliveries = perMonth * months;
  const pct = DURATION_PCT[months] ?? 8;
  const gross = basePrice * deliveries;
  const discount = Math.round((gross * pct) / 100);
  const net = gross - discount;
  return { deliveries, pct, gross, discount, net, perDelivery: Math.round(net / deliveries) };
}

export const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
