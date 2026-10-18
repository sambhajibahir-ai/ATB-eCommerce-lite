import { Router } from 'express';
import { db } from '../db.js';
import { GST_STATES } from '../services/gst.js';
import { writeInvoicePdf } from '../services/invoicePdf.js';
import { availableMethods, getProvider } from '../services/payments/index.js';
import { createOrder, HttpError, markOrderFailed, markOrderPaid, publicOrder } from '../services/orders.js';
import { shiprocket } from '../services/shiprocket.js';

export const store = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

store.get('/config', (req, res) => {
  res.json({ paymentMethods: availableMethods(), states: GST_STATES });
});

store.get('/products', (req, res) => {
  res.json(db.listProducts().map(({ sku, name, description, pricePaise, gstRate, hsn, stock, image }) =>
    ({ sku, name, description, pricePaise, gstRate, hsn, stock, image })));
});

store.get('/shipping/serviceability', wrap(async (req, res) => {
  const { pincode, weight, cod } = req.query;
  if (!/^\d{6}$/.test(pincode || '')) throw new HttpError(400, 'Invalid pincode');
  res.json(await shiprocket.serviceability({ pincode, weightKg: Number(weight) || 0.5, cod: cod === '1' }));
}));

// 1) Create order (server prices + GST) and 2) initiate payment with the chosen gateway.
store.post('/orders', wrap(async (req, res) => {
  const order = createOrder(req.body);
  if (order.paymentMethod === 'cod') {
    const done = await markOrderPaid(order.id, { via: 'cod', cod: true });
    return res.status(201).json({ order: publicOrder(done), payment: { method: 'cod' } });
  }
  const { provider, live } = getProvider(order.paymentMethod);
  try {
    const init = await provider.initiate(order);
    db.updateOrder(order.id, { payment: { ...order.payment, gatewayOrderId: init.gatewayOrderId, live } });
    res.status(201).json({ order: publicOrder(db.getOrder(order.id)), payment: { method: order.paymentMethod, live, ...init.client } });
  } catch (e) {
    markOrderFailed(order.id, e.message);
    throw new HttpError(502, `Could not start payment: ${e.message}`);
  }
}));

store.get('/orders/:id', (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  res.json(publicOrder(o));
});

// 3) Verify payment after checkout returns (signature / status API / UTR).
store.post('/orders/:id/verify', wrap(async (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  if (['paid', 'confirmed', 'shipped', 'delivered'].includes(order.status)) return res.json(publicOrder(order));

  const { provider } = order.payment.live === false ? getProvider('mock') : getProvider(order.paymentMethod);
  const result = await provider.verify(order, req.body);
  if (result.status === 'paid') {
    await markOrderPaid(order.id, { reference: result.reference, instrument: result.instrument, via: 'verify' });
  } else if (result.status === 'review') {
    db.updateOrder(order.id, {
      status: 'payment_review',
      payment: { ...order.payment, status: 'review', reference: result.reference, instrument: result.instrument },
      history: [...order.history, { at: new Date().toISOString(), status: 'payment_review', note: `UTR ${result.reference}` }],
    });
  } else if (result.status === 'failed') {
    if (result.error && order.paymentMethod === 'upi_direct') throw new HttpError(400, result.error);
    markOrderFailed(order.id, result.error || 'Payment failed');
  }
  res.json(publicOrder(db.getOrder(order.id)));
}));

// Retry payment for a failed / abandoned order (creates a fresh gateway order).
store.post('/orders/:id/retry', wrap(async (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  if (!['pending_payment', 'payment_failed'].includes(order.status)) throw new HttpError(400, 'Order is not awaiting payment');
  const { provider, live } = getProvider(order.paymentMethod);
  const attempt = (order.payment.attempt || 1) + 1;
  const init = await provider.initiate({ ...order, attempt });
  db.updateOrder(order.id, { status: 'pending_payment', payment: { status: 'pending', gatewayOrderId: init.gatewayOrderId, live, attempt } });
  res.json({ order: publicOrder(db.getOrder(order.id)), payment: { method: order.paymentMethod, live, ...init.client } });
}));

store.get('/orders/:id/invoice.pdf', (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (!o.invoiceNumber) return res.status(409).json({ error: 'Invoice is generated once payment is confirmed' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${o.invoiceNumber.replace(/\//g, '-')}.pdf"`);
  writeInvoicePdf(o, res);
});

store.get('/orders/:id/tracking', wrap(async (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o) throw new HttpError(404, 'Order not found');
  if (!o.shipment?.awb) return res.json({ status: 'Not shipped yet', events: [] });
  res.json(await shiprocket.track(o.shipment.awb));
}));
