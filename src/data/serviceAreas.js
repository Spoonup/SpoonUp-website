// TODO: Handle core functionality later — replace with a serviceability endpoint.
// Per the handoff: the pincode decides whether eat-now items can be ordered.
// Pantry ships nationwide, so an unserviced pincode only disables the kitchen.

export const SERVICE_AREAS = [
  { pincode: '560095', area: 'Koramangala', eta: '~35 min' },
  { pincode: '560034', area: 'Koramangala 6th Block', eta: '~35 min' },
  { pincode: '560038', area: 'Indiranagar', eta: '~40 min' },
  { pincode: '560102', area: 'HSR Layout', eta: '~45 min' },
  { pincode: '560029', area: 'Jayanagar', eta: '~45 min' },
  { pincode: '560025', area: 'Residency Road', eta: '~40 min' }
];

export const DEFAULT_AREA = SERVICE_AREAS[0];

export function lookupPincode(raw) {
  const pin = String(raw || '').replace(/\D/g, '').slice(0, 6);
  if (pin.length !== 6) return { status: 'invalid', pincode: pin };
  const match = SERVICE_AREAS.find((a) => a.pincode === pin);
  if (match) return { status: 'serviceable', ...match };
  return { status: 'unserviced', pincode: pin, area: null, eta: null };
}
