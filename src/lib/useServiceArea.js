import { useContext } from 'react';
import { ServiceAreaContext } from './serviceAreaContextObject';

export function useServiceArea() {
  const ctx = useContext(ServiceAreaContext);
  if (!ctx) throw new Error('useServiceArea must be used inside <ServiceAreaProvider>');
  return ctx;
}
