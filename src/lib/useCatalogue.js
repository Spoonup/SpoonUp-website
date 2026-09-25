import { useContext } from 'react';
import { CatalogueContext } from './catalogueContextObject';

export function useCatalogue() {
  const ctx = useContext(CatalogueContext);
  if (!ctx) throw new Error('useCatalogue must be used inside <CatalogueProvider>');
  return ctx;
}
