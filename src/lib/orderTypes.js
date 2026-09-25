/**
 * The three order types drive colour everywhere in the design:
 *   kitchen -> olive, plan -> ink/forest, pantry -> almond.
 * This is the single source for that mapping.
 */
export const ORDER_TYPES = {
  kitchen: {
    label: 'Eat now',
    badge: 'NOW · 30–45 MIN',
    color: 'var(--color-olive)',
    tint: 'var(--color-tint-olive)'
  },
  plan: {
    label: 'Plan',
    badge: 'PLAN · UP TO 18% OFF',
    color: 'var(--color-ink)',
    tint: 'var(--color-tint-ink)'
  },
  pantry: {
    label: 'Pantry',
    badge: 'SHIPS · 3–5 DAYS',
    color: 'var(--color-almond)',
    tint: 'var(--color-tint-almond)'
  }
};
