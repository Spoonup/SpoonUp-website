import { useContext } from 'react';
import { UserContext } from './userContextObject';

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used inside <UserProvider>');
  return ctx;
}
