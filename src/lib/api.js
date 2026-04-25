const API_BASE = '';

function getAuthHeaders() {
  const token = localStorage.getItem('mv_admin_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function handleResponse(res) {
  if (res.status === 401) {
    // Session expired or invalid
    localStorage.removeItem('mv_admin_token');
    localStorage.removeItem('mv_admin_user');
    window.location.href = '/admin/login?expired=true';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'An unexpected error occurred' }));
    throw new Error(err.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function fetchMenu(restaurantSlug) {
  const url = restaurantSlug
    ? `${API_BASE}/api/menu?restaurant_slug=${restaurantSlug}`
    : `${API_BASE}/api/menu`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load menu');
  return res.json();
}

export async function fetchTableInfo(tableId) {
  const res = await fetch(`${API_BASE}/api/tables/${tableId}`);
  if (!res.ok) throw new Error('Table not found');
  return res.json();
}

export async function fetchMenuItem(dishId) {
  const res = await fetch(`${API_BASE}/api/menu/item/${dishId}`);
  if (!res.ok) throw new Error('Menu item not found');
  return res.json();
}

export async function placeOrder(payload) {
  const res = await fetch(`${API_BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to place order');
  }
  return res.json();
}

export async function fetchOrderStatus(orderId) {
  const res = await fetch(`${API_BASE}/api/orders/${orderId}`);
  if (!res.ok) throw new Error('Order not found');
  return res.json();
}

export async function fetchTableOrders(tableId) {
  const res = await fetch(`${API_BASE}/api/tables/${tableId}/orders`);
  if (!res.ok) throw new Error('Failed to fetch table orders');
  return res.json();
}

// ── Admin API ────────────────────────────────────────────────────────────────

export async function adminFetchOrders(status) {
  const url = status
    ? `${API_BASE}/api/admin/orders?status=${status}`
    : `${API_BASE}/api/admin/orders`;
  const res = await fetch(url, { headers: getAuthHeaders() });
  return handleResponse(res);
}

export async function adminUpdateOrderStatus(orderId, status, cancelReason) {
  const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ status, cancel_reason: cancelReason }),
  });
  return handleResponse(res);
}

export async function adminFetchMenuItems() {
  const res = await fetch(`${API_BASE}/api/admin/menu-items`, { headers: getAuthHeaders() });
  return handleResponse(res);
}

export async function adminCreateMenuItem(data) {
  const res = await fetch(`${API_BASE}/api/admin/menu-items`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function adminUpdateMenuItem(id, data) {
  const res = await fetch(`${API_BASE}/api/admin/menu-items/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function adminFetchCategories() {
  const res = await fetch(`${API_BASE}/api/admin/categories`, { headers: getAuthHeaders() });
  return handleResponse(res);
}


export async function adminFetchTables() {
  const res = await fetch(`${API_BASE}/api/admin/tables`, { headers: getAuthHeaders() });
  return handleResponse(res);
}

export async function adminCreateTable(data) {
  const res = await fetch(`${API_BASE}/api/admin/tables`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function adminUpdateTable(id, data) {
  const res = await fetch(`${API_BASE}/api/admin/tables/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function seedDatabase() {
  const res = await fetch(`${API_BASE}/api/seed`, { method: 'POST' });
  return res.json();
}

export async function adminUpdateRestaurant(data) {
  const res = await fetch(`${API_BASE}/api/admin/restaurant`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

