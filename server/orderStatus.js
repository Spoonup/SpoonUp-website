/**
 * Per-type status machines. Each sub-order type has its own lifecycle; forcing
 * one workflow onto all of them is what makes "sourcing" reachable from a
 * smoothie. Terminal states have no outgoing transitions.
 *
 * LEGACY_* keep the pre-split vocabularies working so orders written before the
 * parent/sub-order migration still transition exactly as they did.
 */

const TERMINAL = ['delivered', 'cancelled', 'refunded', 'returned', 'completed'];

export const STATUS_MACHINES = {
  IMMEDIATE: {
    initial: 'pending',
    transitions: {
      pending: ['preparing', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready: ['out_for_delivery', 'completed', 'cancelled'],
      out_for_delivery: ['delivered', 'failed_delivery'],
      failed_delivery: ['out_for_delivery', 'refunded', 'cancelled'],
      delivered: [],
      completed: [],
      cancelled: [],
      refunded: []
    }
  },
  SCHEDULED: {
    initial: 'scheduled',
    transitions: {
      scheduled: ['preparing', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready: ['out_for_delivery', 'completed', 'cancelled'],
      out_for_delivery: ['delivered', 'failed_delivery'],
      failed_delivery: ['out_for_delivery', 'refunded', 'cancelled'],
      delivered: [],
      completed: [],
      cancelled: [],
      refunded: []
    }
  },
  DELIVERY_IN_DAYS: {
    initial: 'pending',
    transitions: {
      pending: ['sourcing', 'cancelled'],
      sourcing: ['packed', 'cancelled'],
      packed: ['shipped', 'cancelled'],
      shipped: ['delivered', 'returned'],
      returned: ['refunded'],
      delivered: [],
      cancelled: [],
      refunded: []
    }
  },
  SUBSCRIPTION_DELIVERY: {
    initial: 'scheduled',
    transitions: {
      // No direct cancel: skip the delivery or cancel the plan, so the wallet
      // always has a matching ledger entry.
      scheduled: ['preparing', 'skipped'],
      preparing: ['ready'],
      ready: ['out_for_delivery', 'completed'],
      out_for_delivery: ['delivered', 'failed_delivery'],
      failed_delivery: ['out_for_delivery', 'reversed'],
      skipped: [],
      reversed: [],
      delivered: [],
      completed: []
    }
  }
};

// Pre-migration orders used these two flat vocabularies with no ordering rules.
export const LEGACY_STATUSES = {
  immediate: ['pending', 'preparing', 'ready', 'completed', 'cancelled'],
  delivery: ['pending', 'shipped', 'delivered', 'rejected', 'refunded', 'cancelled']
};

export function machineFor(subOrderType) {
  return STATUS_MACHINES[subOrderType] || null;
}

export function initialStatusFor(subOrderType) {
  return machineFor(subOrderType)?.initial || 'pending';
}

export function allStatusesFor(subOrderType) {
  const m = machineFor(subOrderType);
  return m ? Object.keys(m.transitions) : [];
}

export function isTerminal(status) {
  return TERMINAL.includes(status);
}

/**
 * Whether `to` is reachable from `from` for this type.
 * An order with no sub_order_type is legacy: fall back to the flat vocabulary so
 * historic rows keep working.
 */
export function canTransition(subOrderType, from, to) {
  const m = machineFor(subOrderType);
  if (!m) {
    const vocab = LEGACY_STATUSES[subOrderType === 'delivery' ? 'delivery' : 'immediate'];
    return vocab.includes(to);
  }
  const allowed = m.transitions[from];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(to);
}

export function assertTransition(subOrderType, from, to) {
  if (from === to) {
    const err = new Error(`Order is already ${to}.`);
    err.status = 400;
    err.code = 'STATUS_UNCHANGED';
    throw err;
  }
  if (!canTransition(subOrderType, from, to)) {
    const allowed = machineFor(subOrderType)?.transitions?.[from] || [];
    const err = new Error(
      allowed.length
        ? `Cannot move a ${subOrderType} order from ${from} to ${to}. Allowed: ${allowed.join(', ')}.`
        : `${from} is a final state for a ${subOrderType} order.`
    );
    err.status = 400;
    err.code = 'INVALID_STATUS_TRANSITION';
    throw err;
  }
}
