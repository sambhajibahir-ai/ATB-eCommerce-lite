// Cashfree Payments PG (API version 2023-08-01) — UPI, cards, wallets,
// netbanking, Pay Later, EMI via one hosted checkout.
// Docs: https://docs.cashfree.com/docs/payment-gateway
import crypto from 'node:crypto';
import { config } from '../../config.js';

const API_VERSION = '2023-08-01';
const base = () =>
  config.cashfree.env === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

async function cf(path, options = {}) {
  const res = await fetch(`${base()}${path}`, {
    ...options,
    headers: {
      'x-client-id': config.cashfree.appId,
      'x-client-secret': config.cashfree.secretKey,
      'x-api-version': API_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Cashfree ${res.status}: ${body?.message || JSON.stringify(body)}`);
  return body;
}

// Cashfree order_id: alphanumeric, "-" and "_" only, max 45 chars, unique per attempt.
const cfOrderId = (order) => `ord_${order.id.replace(/-/g, '')}_${order.attempt || 1}`;

export const cashfree = {
  async initiate(order) {
    const gatewayOrderId = cfOrderId(order);
    const body = await cf('/orders', {
      method: 'POST',
      body: JSON.stringify({
        order_id: gatewayOrderId,
        order_amount: order.totals.grandTotalPaise / 100, // Cashfree takes rupees
        order_currency: 'INR',
        customer_details: {
          customer_id: order.customer.phone.replace(/\D/g, '').slice(-10),
          customer_name: order.customer.name,
          customer_email: order.customer.email,
          customer_phone: order.customer.phone.replace(/\D/g, '').slice(-10),
        },
        order_meta: {
          return_url: `${config.clientUrl}/order/${order.id}?cf_return=1`,
          notify_url: `${config.serverUrl}/api/webhooks/cashfree`,
        },
        order_note: `Store order ${order.id}`,
      }),
    });
    return {
      gatewayOrderId,
      client: { paymentSessionId: body.payment_session_id, mode: config.cashfree.env },
    };
  },

  /** Never trust the redirect alone — always fetch the order status from Cashfree. */
  async verify(order) {
    const o = await cf(`/orders/${order.payment.gatewayOrderId}`);
    if (Math.round(Number(o.order_amount) * 100) !== order.totals.grandTotalPaise) {
      return { status: 'failed', error: 'Amount mismatch' };
    }
    if (o.order_status === 'PAID') {
      const pays = await cf(`/orders/${order.payment.gatewayOrderId}/payments`);
      const ok = Array.isArray(pays) ? pays.find((p) => p.payment_status === 'SUCCESS') : null;
      return { status: 'paid', reference: ok?.cf_payment_id ? String(ok.cf_payment_id) : o.cf_order_id, instrument: ok?.payment_group };
    }
    if (o.order_status === 'EXPIRED' || o.order_status === 'TERMINATED') return { status: 'failed' };
    return { status: 'pending' };
  },

  /** Webhook: x-webhook-signature = base64(HMAC_SHA256(timestamp + rawBody, secretKey)). */
  parseWebhook(rawBody, headers) {
    const sig = headers['x-webhook-signature'];
    const ts = headers['x-webhook-timestamp'];
    if (!sig || !ts) return null;
    const expected = crypto
      .createHmac('sha256', config.cashfree.secretKey)
      .update(ts + rawBody.toString('utf8'))
      .digest('base64');
    if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    const evt = JSON.parse(rawBody.toString('utf8'));
    const d = evt.data || {};
    return {
      event: evt.type,
      gatewayOrderId: d.order?.order_id,
      reference: d.payment?.cf_payment_id ? String(d.payment.cf_payment_id) : undefined,
      amount: d.order?.order_amount !== undefined ? Math.round(Number(d.order.order_amount) * 100) : undefined,
      instrument: d.payment?.payment_group,
      status: d.payment?.payment_status === 'SUCCESS' ? 'paid'
        : ['FAILED', 'USER_DROPPED'].includes(d.payment?.payment_status) ? 'failed' : 'pending',
    };
  },
};
