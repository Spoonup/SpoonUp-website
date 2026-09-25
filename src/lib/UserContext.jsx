import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserContext } from './userContextObject';
import { api, getUserToken, setUserToken } from './api';

/** Customer session backed by the real /api/auth endpoints (username + password). */
export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getUserToken()));

  useEffect(() => {
    if (!getUserToken()) return undefined;
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (!cancelled) setUser(data.user || null);
      })
      .catch(() => {
        if (!cancelled) {
          setUserToken('');
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api.login({ username, password });
    setUserToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const signup = useCallback(async (payload) => {
    const data = await api.signup(payload);
    setUserToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUserToken('');
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, checking, login, signup, logout, isSignedIn: Boolean(user) }),
    [user, checking, login, signup, logout]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
