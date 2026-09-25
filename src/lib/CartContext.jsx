import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { CartContext } from './cartContextObject';
import { useCatalogue } from './useCatalogue';
import { getProduct } from '../data/catalogue';

// TODO: Handle core functionality later — this is presentation-layer state only.
// It is not persisted and never reaches the server; checkout is a mock.
// The real shape should follow the handoff:
//   { kitchen: {items[], mode, slot}, plans: [...], pantry: {items[], addressId} }

const STORAGE_KEY = 'spoonup_cart';

function readStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

export function CartProvider({ children }) {
  const { products, loading: catalogueLoading } = useCatalogue();
  // A cart that empties on refresh feels broken; persist it per browser.
  const [stored] = useState(readStored);
  const [kitchen, setKitchen] = useState(() => stored?.kitchen ?? []);
  const [pantry, setPantry] = useState(() => stored?.pantry ?? []);
  const [plans, setPlans] = useState(() => stored?.plans ?? []);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((payload) => {
    setToast(payload);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const addItem = useCallback(
    (product, { size, qty = 1 } = {}) => {
      const target = product.type === 'pantry' ? setPantry : setKitchen;
      const key = size ? `${product.id}__${size.label}` : product.id;
      const unitPrice = size ? size.price : product.price;

      target((prev) => {
        const found = prev.find((r) => r.key === key);
        if (found) {
          return prev.map((r) => (r.key === key ? { ...r, qty: r.qty + qty } : r));
        }
        return [
          ...prev,
          {
            key,
            id: product.id,
            name: product.name,
            image: product.image,
            type: product.type,
            size: size?.label,
            unitPrice,
            gstRate: Number(product.gstRate ?? 5),
            qty
          }
        ];
      });

      showToast({ name: product.name, image: product.image, price: unitPrice });
    },
    [showToast]
  );

  const addPlan = useCallback(
    (plan) => {
      setPlans((prev) => [...prev, { ...plan, key: `plan__${plan.productId}__${Date.now()}` }]);
      const product = getProduct(plan.productId);
      if (product) showToast({ name: `${product.name} plan`, image: product.image, price: plan.net });
    },
    [showToast]
  );

  const setQty = useCallback((key, qty, type) => {
    const target = type === 'pantry' ? setPantry : setKitchen;
    target((prev) => (qty <= 0 ? prev.filter((r) => r.key !== key) : prev.map((r) => (r.key === key ? { ...r, qty } : r))));
  }, []);

  const removePlan = useCallback((key) => setPlans((prev) => prev.filter((p) => p.key !== key)), []);

  const clear = useCallback(() => {
    setKitchen([]);
    setPantry([]);
    setPlans([]);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ kitchen, pantry, plans }));
    } catch {
      // storage unavailable (private window, blocked site data) — cart stays in memory
    }
  }, [kitchen, pantry, plans]);

  // A persisted cart can outlive the catalogue: products get delisted, and prices
  // change. The server re-prices every line at checkout, so a stale snapshot here
  // means the button promises a total the gateway will not charge. Drop delisted
  // rows and re-sync price + gstRate from the live catalogue.
  const [dropped, setDropped] = useState([]);
  useEffect(() => {
    if (catalogueLoading || products.length === 0) return undefined;
    const live = new Map(products.map((p) => [p.id, p]));
    const rows = [...kitchen, ...pantry];
    const stale = rows.filter((row) => !live.has(row.id));
    const mispriced = rows.filter((row) => {
      const p = live.get(row.id);
      if (!p) return false;
      // Sized rows carry their own price; only plain rows track the base price.
      const price = row.size ? row.unitPrice : p.price;
      return price !== row.unitPrice || (row.gstRate ?? null) !== Number(p.gstRate ?? 5);
    });
    if (stale.length === 0 && mispriced.length === 0) return undefined;

    const resync = (prev) =>
      prev
        .filter((row) => live.has(row.id))
        .map((row) => {
          const p = live.get(row.id);
          return {
            ...row,
            unitPrice: row.size ? row.unitPrice : p.price,
            gstRate: Number(p.gstRate ?? 5)
          };
        });

    // Deferred a tick so the effect never sets state synchronously.
    const t = setTimeout(() => {
      if (stale.length > 0) setDropped(stale.map((row) => row.name));
      setKitchen(resync);
      setPantry(resync);
    }, 0);
    return () => clearTimeout(t);
  }, [catalogueLoading, products, kitchen, pantry]);

  const value = useMemo(() => {
    const lineTotal = (rows) => rows.reduce((sum, r) => sum + r.unitPrice * r.qty, 0);
    const kitchenTotal = lineTotal(kitchen);
    const pantryTotal = lineTotal(pantry);
    const plansTotal = plans.reduce((sum, p) => sum + p.net, 0);
    const planDiscount = plans.reduce((sum, p) => sum + p.discount, 0);
    const itemCount =
      kitchen.reduce((s, r) => s + r.qty, 0) + pantry.reduce((s, r) => s + r.qty, 0) + plans.length;
    const groupCount = [kitchen.length, plans.length, pantry.length].filter(Boolean).length;

    return {
      kitchen,
      pantry,
      plans,
      toast,
      dismissToast: () => setToast(null),
      dropped,
      clearDropped: () => setDropped([]),
      addItem,
      addPlan,
      setQty,
      removePlan,
      clear,
      count: itemCount,
      groupCount,
      kitchenTotal,
      pantryTotal,
      plansTotal,
      planDiscount,
      itemsTotal: kitchenTotal + pantryTotal + plansTotal
    };
  }, [kitchen, pantry, plans, toast, dropped, addItem, addPlan, setQty, removePlan, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

