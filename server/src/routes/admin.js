import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { applyStockUpdates, pullInventory } from '../services/inventorySync.js';
import { HttpError, markOrderFailed, markOrderPaid, shipOrder } from '../services/orders.js';

export const admin = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

admin.use((req, res, next) => {
  const token = String(req.headers['x-admin-token'] || '');
  const ok = token.length === config.adminToken.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.adminToken));
  if (!ok) return res.status(401).json({ error: 'Invalid admin token' });
  next();
});

admin.get('/orders', (req, res) => res.json(db.listOrders()));

// Direct-UPI: confirm (or reject) after matching the UTR on your bank statement.
admin.post('/orders/:id/confirm-upi', wrap(async (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o || o.status !== 'payment_review') throw new HttpError(400, 'Order is not awaiting UPI review');
  const result = req.body?.approve === false
    ? markOrderFailed(o.id, 'UTR not found in bank statement')
    : await markOrderPaid(o.id, { reference: o.payment.reference, instrument: 'upi', via: 'admin' });
  res.json(result);
}));

admin.post('/orders/:id/ship', wrap(async (req, res) => res.json(await shipOrder(req.params.id))));

admin.post('/orders/:id/delivered', (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const now = new Date().toISOString();
  res.json(db.updateOrder(o.id, {
    status: 'delivered',
    payment: o.paymentMethod === 'cod' ? { ...o.payment, status: 'captured', paidAt: now } : o.payment,
    history: [...o.history, { at: now, status: 'delivered' }],
  }));
});

admin.post('/inventory/sync', wrap(async (req, res) => res.json(await pullInventory())));
admin.post('/inventory/set', (req, res) => res.json(applyStockUpdates(req.body?.items, 'admin')));
admin.get('/inventory/log', (req, res) => res.json(db.inventoryLog()));
