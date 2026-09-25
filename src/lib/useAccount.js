import { useContext } from 'react';
import { AccountContext } from './accountContextObject';

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside <AccountProvider>');
  return ctx;
}
