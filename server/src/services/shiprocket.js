// Shiprocket aggregator: one API for Delhivery, Blue Dart, Xpressbees, Ekart,
// DTDC, Shadowfax and more. Docs: https://apidocs.shiprocket.in/
// Without credentials every call returns mock data so the flow stays testable.
import { config, isConfigured } from '../config.js';

const API = 'https://apiv2.shiprocket.in/v1/external';
let token = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiresAt) return token;
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.shipping.email, password: config.shipping.password }),
  });
  const body = await res.json();
  if (!res.ok || !body.token) throw new Error(`Shiprocket login failed: ${body?.message || res.status}`);
  token = body.token;
  tokenExpiresAt = Date.now() + 9 * 24 * 3600 * 1000; // token is valid 10 days
  return token;
}

async function sr(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shiprocket ${res.status}: ${body?.message || JSON.stringify(body)}`);
  return body;
}

// Combined parcel: sum weights, take the largest box dimensions.
function parcelFor(order) {
  const goods = order.lines;
  return {
    weight: Math.max(0.1, goods.reduce((s, l) => s + (l.weightKg || 0.5) * l.qty, 0)),
    length: Math.max(...goods.map((l) => l.dims?.l || 10)),
    breadth: Math.max(...goods.map((l) => l.dims?.b || 10)),
    height: Math.max(10, goods.reduce((s, l) => s + (l.dims?.h || 5) * l.qty, 0)),
  };
}

export const shiprocket = {
  live: () => isConfigured.shiprocket(),

  async serviceability({ pincode, weightKg = 0.5, cod = false }) {
    if (!this.live()) return { mock: true, serviceable: /^\d{6}$/.test(pincode), couriers: [{ name: 'Mock Express', etdDays: 4, ratePaise: 4900 }] };
    const q = new URLSearchParams({ pickup_postcode: config.shipping.pickupPincode, delivery_postcode: pincode, weight: String(weightKg), cod: cod ? '1' : '0' });
    const body = await sr(`/courier/serviceability/?${q}`);
    const list = body?.data?.available_courier_companies || [];
    return {
      serviceable: list.length > 0,
      couriers: list.slice(0, 5).map((c) => ({ name: c.courier_name, etdDays: Number(c.estimated_delivery_days), ratePaise: Math.round(c.rate * 100) })),
    };
  },

  /** Creates the order in Shiprocket, then assigns an AWB (auto-selects the recommended courier). */
  async createShipment(order) {
    if (!this.live()) {
      return { mock: true, shipmentId: `MOCK-${order.id.slice(0, 6)}`, awb: `MOCKAWB${Date.now().toString().slice(-8)}`, courier: 'Mock Express' };
    }
    const p = parcelFor(order);
    const [first, ...rest] = order.customer.name.trim().split(' ');
    const created = await sr('/orders/create/adhoc', {
      method: 'POST',
      body: JSON.stringify({
        order_id: order.invoiceNumber || order.id.slice(0, 20),
        order_date: new Date(order.createdAt).toISOString().slice(0, 16).replace('T', ' '),
        pickup_location: config.shipping.pickupLocation,
        billing_customer_name: first,
        billing_last_name: rest.join(' ') || '.',
        billing_address: order.address.line1,
        billing_city: order.address.city,
        billing_pincode: order.address.pincode,
        billing_state: order.address.state,
        billing_country: 'India',
        billing_email: order.customer.email,
        billing_phone: order.customer.phone.replace(/\D/g, '').slice(-10),
        shipping_is_billing: true,
        order_items: order.lines.map((l) => ({
          name: l.name, sku: l.sku, units: l.qty, selling_price: (l.unitPaise * (100 + l.gstRate)) / 10000, hsn: l.hsn,
        })),
        payment_method: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
        sub_total: order.totals.grandTotalPaise / 100,
        length: p.length, breadth: p.breadth, height: p.height, weight: p.weight,
      }),
    });
    const awbRes = await sr('/courier/assign/awb', {
      method: 'POST',
      body: JSON.stringify({ shipment_id: created.shipment_id }),
    });
    const d = awbRes?.response?.data || {};
    return { shipmentId: created.shipment_id, srOrderId: created.order_id, awb: d.awb_code, courier: d.courier_name };
  },

  async track(awb) {
    if (!this.live() || String(awb).startsWith('MOCK')) {
      return { mock: true, status: 'In Transit', events: [{ at: new Date().toISOString(), activity: 'Shipment picked up (mock)', location: 'Origin hub' }] };
    }
    const body = await sr(`/courier/track/awb/${encodeURIComponent(awb)}`);
    const t = body?.tracking_data || {};
    return {
      status: t.shipment_track?.[0]?.current_status || 'Unknown',
      etd: t.etd,
      trackUrl: t.track_url,
      events: (t.shipment_track_activities || []).map((a) => ({ at: a.date, activity: a.activity, location: a.location })),
    };
  },
};
