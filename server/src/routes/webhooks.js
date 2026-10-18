// Webhooks are the source of truth for payment status: they still arrive when the
// customer closes the browser before the verify call. These routes receive the
// RAW body (see index.js) because signatures are computed over the exact bytes.
import { Router } from 'express';
import { db } from '../db.js';
import { applyStockUpdates, verifyInventoryWebhook } from '../services/inventorySync.js';
import { markOrderFailed, markOrderPaid } from '../services/orders.js';
import { cashfree } from '../services/payments/cashfree.js';
import { razorpay } from '../services/payments/razorpay.js';

export const webhooks = Router();

async function handlePaymentEvent(method, evt) {
  if (!evt?.gatewayOrderId) return;
  const order = db.findOrder((o) => o.paymentMethod === method && o.payment?.gatewayOrderId === evt.gatewayOrderId);
  if (!order) return console.warn(`[webhook:${method}] no order for`, evt.gatewayOrderId);
  if (evt.status === 'paid') {
    if (evt.amount !== undefined && evt.amount !== order.totals.grandTotalPaise) {
      return console.error(`[webhook:${method}] amount mismatch on order ${order.id}`);
    }
    await markOrderPaid(order.id, { reference: evt.reference, instrument: evt.instrument, via: 'webhook' });
  } else if (evt.status === 'failed') {
    markOrderFailed(order.id, `${method} reported failure`);
  }
}

webhooks.post('/webhooks/razorpay', async (req, res) => {
  const evt = razorpay.parseWebhook(req.body, req.headers);
  if (!evt) return res.status(400).json({ error: 'Invalid signature' });
  try { await handlePaymentEvent('razorpay', evt); } catch (e) { console.error('[webhook:razorpay]', e); }
  res.json({ ok: true }); // always 2xx after a valid signature, or the gateway keeps retrying
});

webhooks.post('/webhooks/cashfree', async (req, res) => {
  const evt = cashfree.parseWebhook(req.body, req.headers);
  if (!evt) return res.status(400).json({ error: 'Invalid signature' });
  try { await handlePaymentEvent('cashfree', evt); } catch (e) { console.error('[webhook:cashfree]', e); }
  res.json({ ok: true });
});

// Billing software → store: { "items": [{ "sku": "TS-KB-001", "stock": 12 }] }
webhooks.post('/inventory/webhook', (req, res) => {
  if (!verifyInventoryWebhook(req.body, req.headers['x-signature'])) return res.status(401).json({ error: 'Invalid signature' });
  const body = JSON.parse(req.body.toString('utf8'));
  res.json(applyStockUpdates(Array.isArray(body) ? body : body.items, 'webhook'));
});
