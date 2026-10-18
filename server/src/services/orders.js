import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';
import { computeTotals, GST_STATES, isValidGstin, nextInvoiceNumber } from './gst.js';
import { pushSaleToBilling } from './inventorySync.js';
import { shiprocket } from './shiprocket.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Validates input and prices everything server-side (never trust client prices). */
export function createOrder({ items, customer, address, paymentMethod }) {
  if (!config.paymentMethods.includes(paymentMethod)) throw new HttpError(400, 'Payment method not available');
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Cart is empty');
  if (!customer?.name || !/^\S+@\S+\.\S+$/.test(customer.email || '') || !/^(\+91)?[6-9]\d{9}$/.test(String(customer.phone || '').replace(/[\s-]/g, ''))) {
    throw new HttpError(400, 'Enter a valid name, email and 10-digit Indian mobile number');
  }
  if (!address?.line1 || !address?.city || !/^\d{6}$/.test(address.pincode || '') || !GST_STATES[address.stateCode]) {
    throw new HttpError(400, 'Enter a complete address with a valid 6-digit pincode and state');
  }
  if (customer.gstin && !isValidGstin(customer.gstin)) throw new HttpError(400, 'Invalid GSTIN');
  // For B2B, place of supply comes from the buyer's GSTIN state code.
  const placeOfSupplyCode = customer.gstin ? customer.gstin.slice(0, 2) : address.stateCode;

  const lines = items.map(({ sku, qty }) => {
    const p = db.getProductBySku(sku);
    const q = Math.floor(Number(qty));
    if (!p || p.active === false) throw new HttpError(400, `Unknown product ${sku}`);
    if (!(q >= 1 && q <= 20)) throw new HttpError(400, `Invalid quantity for ${p.name}`);
    if (p.stock < q) throw new HttpError(409, `Only ${p.stock} left of ${p.name}`);
    return { sku, name: p.name, hsn: p.hsn, gstRate: p.gstRate, unitPaise: p.pricePaise, qty: q, weightKg: p.weightKg, dims: p.dims };
  });

  const totals = computeTotals({ lines, placeOfSupplyCode, paymentMethod });
  if (paymentMethod === 'cod' && totals.grandTotalPaise > config.cod.maxOrderPaise) {
    throw new HttpError(400, `Cash on delivery is available up to Rs. ${config.cod.maxOrderPaise / 100}`);
  }

  const now = new Date().toISOString();
  return db.insertOrder({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: 'pending_payment',
    paymentMethod,
    customer: { name: customer.name.trim(), email: customer.email.trim(), phone: customer.phone.trim(), gstin: customer.gstin?.toUpperCase() || '' },
    address: { ...address, state: GST_STATES[address.stateCode] },
    lines,
    totals,
    payment: { status: 'pending' },
    shipment: null,
    history: [{ at: now, status: 'pending_payment' }],
  });
}

const FINAL = ['paid', 'confirmed', 'shipped', 'delivered'];

/**
 * Idempotent: called from the verify endpoint, the webhook, or an admin action —
 * whichever arrives first wins, later calls are no-ops.
 */
export async function markOrderPaid(orderId, { reference, instrument, via, cod = false }) {
  const order = db.getOrder(orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (FINAL.includes(order.status)) return order;

  for (const l of order.lines) db.adjustStock(l.sku, -l.qty, `order:${order.id.slice(0, 8)}`);
  const status = cod ? 'confirmed' : 'paid';
  const now = new Date().toISOString();
  db.updateOrder(order.id, {
    status,
    invoiceNumber: nextInvoiceNumber(),
    invoiceDate: now,
    payment: { ...order.payment, status: cod ? 'cod_pending' : 'captured', reference, instrument, via, paidAt: cod ? null : now },
    history: [...order.history, { at: now, status, via }],
  });

  // Side effects must never block or fail the payment confirmation.
  pushSaleToBilling(order).catch((e) => console.error('[billing] sale push failed:', e.message));
  if (config.shipping.autoCreate) shipOrder(order.id).catch((e) => console.error('[shipping] auto-create failed:', e.message));
  return db.getOrder(order.id);
}

export function markOrderFailed(orderId, reason) {
  const order = db.getOrder(orderId);
  if (!order || FINAL.includes(order.status)) return order;
  return db.updateOrder(orderId, {
    status: 'payment_failed',
    payment: { ...order.payment, status: 'failed', error: reason },
    history: [...order.history, { at: new Date().toISOString(), status: 'payment_failed', note: reason }],
  });
}

export async function shipOrder(orderId) {
  const order = db.getOrder(orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (!['paid', 'confirmed'].includes(order.status)) throw new HttpError(400, `Cannot ship an order in status ${order.status}`);
  if (order.shipment?.awb) return order;
  const shipment = await shiprocket.createShipment(order);
  return db.updateOrder(orderId, {
    status: 'shipped',
    shipment: { ...shipment, createdAt: new Date().toISOString() },
    history: [...order.history, { at: new Date().toISOString(), status: 'shipped', note: `AWB ${shipment.awb}` }],
  });
}

// Strip internal fields before sending an order to the browser.
export function publicOrder(o) {
  return {
    id: o.id, status: o.status, createdAt: o.createdAt, paymentMethod: o.paymentMethod,
    customer: o.customer, address: o.address, totals: o.totals, invoiceNumber: o.invoiceNumber || null,
    payment: { status: o.payment.status, reference: o.payment.reference, instrument: o.payment.instrument, error: o.payment.error },
    shipment: o.shipment ? { awb: o.shipment.awb, courier: o.shipment.courier, mock: !!o.shipment.mock } : null,
  };
}
