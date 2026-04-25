// lib/driver-app/auth.js
/**
 * Client-side JWT storage + fetch wrapper for the driver web stub.
 * Token in localStorage. On 401, redirect to /driver/login.
 */

const TOKEN_KEY = 'dd_driver_token';
const ID_KEY = 'dd_driver_id';
const NAME_KEY = 'dd_driver_name';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setSession({ token, driverId, name }) {
  window.localStorage.setItem(TOKEN_KEY, token);
  if (driverId) window.localStorage.setItem(ID_KEY, driverId);
  if (name != null) window.localStorage.setItem(NAME_KEY, name);
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ID_KEY);
  window.localStorage.removeItem(NAME_KEY);
}

export function getDriverId() {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(ID_KEY);
}

/**
 * Authenticated fetch. Auto-attaches Authorization header. On 401 redirects
 * to /driver/login. On all other responses, returns the Response unchanged.
 */
export async function driverFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearSession();
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/driver')) {
      window.location.href = '/driver/login';
    }
  }
  return res;
}
