import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ServiceAreaContext } from './serviceAreaContextObject';
import { DEFAULT_AREA, lookupPincode } from '../data/serviceAreas';

const STORAGE_KEY = 'spoonup_service_area';

function readStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return raw?.pincode ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The delivery pincode. It decides whether eat-now items are orderable; pantry
 * ships everywhere. Persisted per browser so it survives a reload.
 */
export function ServiceAreaProvider({ children }) {
  const [area, setArea] = useState(() => readStored() || { ...DEFAULT_AREA, status: 'serviceable' });
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(area));
    } catch {
      // storage unavailable — keep it in memory
    }
  }, [area]);

  const check = useCallback((raw) => lookupPincode(raw), []);

  const apply = useCallback((result) => {
    if (result.status === 'invalid') return false;
    setArea(result);
    setPickerOpen(false);
    return true;
  }, []);

  const value = useMemo(
    () => ({
      area,
      isServiceable: area.status !== 'unserviced',
      check,
      apply,
      pickerOpen,
      openPicker: () => setPickerOpen(true),
      closePicker: () => setPickerOpen(false)
    }),
    [area, check, apply, pickerOpen]
  );

  return <ServiceAreaContext.Provider value={value}>{children}</ServiceAreaContext.Provider>;
}
