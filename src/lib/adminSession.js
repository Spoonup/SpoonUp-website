export const ADMIN_SESSION_KEY = 'admin_session';
export const ADMIN_SESSION_EXPIRED_EVENT = 'spoonup:admin-session-expired';

export function getAdminSession() {
  try {
    return localStorage.getItem(ADMIN_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function clearAdminSession() {
  try {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    localStorage.removeItem('admin_pin');
  } catch {
    // storage unavailable
  }
}

// Any admin fetch that gets a 401 calls this; App listens and forces a fresh login.
export function notifyAdminSessionExpired() {
  clearAdminSession();
  window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT));
}

export async function adminFetch(url, adminToken, options = {}) {
  const headers = { ...(options.headers || {}), 'x-admin-token': adminToken };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) notifyAdminSessionExpired();
  return res;
}
