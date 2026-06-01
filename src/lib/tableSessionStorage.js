export const TABLE_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const TABLE_SESSION_KEYS = [
  'mv_table_id',
  'mv_table_num',
  'mv_restaurant_slug',
  'mv_table_session_token',
  'mv_table_session_id',
  'mv_table_session_expires',
  'mv_order_type',
];

function getStorage(name) {
  try {
    return globalThis[name] || null;
  } catch {
    return null;
  }
}

export function clearStoredTableSession() {
  const session = getStorage('sessionStorage');
  const local = getStorage('localStorage');
  TABLE_SESSION_KEYS.forEach(key => {
    session?.removeItem(key);
    local?.removeItem(key);
  });
}

export function getTableSessionValue(key) {
  const session = getStorage('sessionStorage');
  const local = getStorage('localStorage');
  const sessionValue = session?.getItem(key);
  if (sessionValue !== null && sessionValue !== undefined) return sessionValue;

  const legacyValue = local?.getItem(key);
  if (legacyValue !== null && legacyValue !== undefined) {
    session?.setItem(key, legacyValue);
    local?.removeItem(key);
    return legacyValue;
  }
  return null;
}

export function setTableSessionValue(key, value) {
  const session = getStorage('sessionStorage');
  const local = getStorage('localStorage');
  if (value === null || value === undefined || value === '') {
    session?.removeItem(key);
  } else {
    session?.setItem(key, String(value));
  }
  local?.removeItem(key);
}

export function getStoredTableSessionToken() {
  const token = getTableSessionValue('mv_table_session_token');
  const expiresAt = Number(getTableSessionValue('mv_table_session_expires') || 0);
  if (!token) return null;
  if (!expiresAt || Date.now() > expiresAt) {
    clearStoredTableSession();
    return null;
  }
  return token;
}
