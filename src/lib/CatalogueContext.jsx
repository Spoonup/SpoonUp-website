import React, { useEffect, useMemo, useState } from 'react';
import { CatalogueContext } from './catalogueContextObject';
import { api } from './api';
import { PRODUCTS as MOCK_PRODUCTS, SUBSCRIBABLE as MOCK_SUBSCRIBABLE } from '../data/catalogue';

/**
 * Live products from GET /api/products, with the design's mock catalogue as a
 * fallback so the UI is still reviewable when the API is unavailable.
 *
 * The backend has no subscription flag, so the plan builder always uses the
 * design catalogue until that lands.
 */
export function CatalogueProvider({ children }) {
  const [products, setProducts] = useState(MOCK_PRODUCTS);
  const [source, setSource] = useState('mock');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [live, liveSettings] = await Promise.all([
          api.products(),
          api.settings().catch(() => null)
        ]);
        if (cancelled) return;
        if (live.length) {
          setProducts(live);
          setSource('api');
        }
        if (liveSettings) setSettings(liveSettings);
      } catch (err) {
        if (!cancelled) console.warn('Falling back to the design catalogue:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      products,
      // TODO: Handle core functionality later — needs a subscribable flag on products.
      subscribable: MOCK_SUBSCRIBABLE,
      settings,
      source,
      loading,
      getProduct: (id) => products.find((p) => p.id === id) || MOCK_PRODUCTS.find((p) => p.id === id)
    }),
    [products, settings, source, loading]
  );

  return <CatalogueContext.Provider value={value}>{children}</CatalogueContext.Provider>;
}
