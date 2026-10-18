async function request(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  config: () => request('/config'),
  products: () => request('/products'),
  serviceability: (pincode, cod) => request(`/shipping/serviceability?pincode=${pincode}&cod=${cod ? 1 : 0}`),
  createOrder: (body) => request('/orders', { method: 'POST', body }),
  order: (id) => request(`/orders/${id}`),
  verify: (id, body) => request(`/orders/${id}/verify`, { method: 'POST', body }),
  retry: (id) => request(`/orders/${id}/retry`, { method: 'POST' }),
  tracking: (id) => request(`/orders/${id}/tracking`),
  admin: (token) => {
    const h = { 'x-admin-token': token };
    return {
      orders: () => request('/admin/orders', { headers: h }),
      confirmUpi: (id, approve) => request(`/admin/orders/${id}/confirm-upi`, { method: 'POST', body: { approve }, headers: h }),
      ship: (id) => request(`/admin/orders/${id}/ship`, { method: 'POST', headers: h }),
      delivered: (id) => request(`/admin/orders/${id}/delivered`, { method: 'POST', headers: h }),
      syncInventory: () => request('/admin/inventory/sync', { method: 'POST', headers: h }),
      inventoryLog: () => request('/admin/inventory/log', { headers: h }),
    };
  },
};

export const rupees = (paise) =>
  (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
