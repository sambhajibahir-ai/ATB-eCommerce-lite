// Razorpay Standard Checkout — one integration gives UPI (intent/collect/QR),
// credit/debit cards, wallets, netbanking, EMI and Pay Later.
// Docs: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
import crypto from 'node:crypto';
import { config } from '../../config.js';

const API = 'https://api.razorpay.com/v1';
const auth = () =>
  'Basic ' + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');

async function rzp(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: auth(), 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Razorpay ${res.status}: ${body?.error?.description || JSON.stringify(body)}`);
  return body;
}

const safeEqual = (a, b) =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const razorpay = {
  /** Step 1 (server): create a Razorpay order for the exact amount in paise. */
  async initiate(order) {
    const rOrder = await rzp('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: order.totals.grandTotalPaise,
        currency: 'INR',
        receipt: order.id.slice(0, 40),
        notes: { store_order_id: order.id },
      }),
    });
    return {
      gatewayOrderId: rOrder.id,
      client: {
        keyId: config.razorpay.keyId,
        razorpayOrderId: rOrder.id,
        amount: rOrder.amount,
        currency: 'INR',
        name: config.seller.name,
        prefill: { name: order.customer.name, email: order.customer.email, contact: order.customer.phone },
      },
    };
  },

  /**
   * Step 3 (server): verify the handler response from Checkout.
   * signature = HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)
   */
  async verify(order, body) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return { status: 'failed', error: 'Missing fields' };
    if (razorpay_order_id !== order.payment.gatewayOrderId) return { status: 'failed', error: 'Order mismatch' };
    const expected = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    if (!safeEqual(expected, String(razorpay_signature))) return { status: 'failed', error: 'Signature mismatch' };

    // Belt and braces: confirm with the API that the payment is captured for the right amount.
    const p = await rzp(`/payments/${razorpay_payment_id}`);
    if (p.amount !== order.totals.grandTotalPaise) return { status: 'failed', error: 'Amount mismatch' };
    if (p.status === 'captured') return { status: 'paid', reference: razorpay_payment_id, instrument: p.method };
    if (p.status === 'authorized') {
      // Auto-capture is on by default in the dashboard; capture manually if it is off.
      await rzp(`/payments/${razorpay_payment_id}/capture`, {
        method: 'POST',
        body: JSON.stringify({ amount: p.amount, currency: 'INR' }),
      });
      return { status: 'paid', reference: razorpay_payment_id, instrument: p.method };
    }
    return { status: 'pending', reference: razorpay_payment_id };
  },

  /** Webhook: X-Razorpay-Signature = HMAC_SHA256(rawBody, webhook_secret). */
  parseWebhook(rawBody, headers) {
    const sig = headers['x-razorpay-signature'];
    if (!config.razorpay.webhookSecret || !sig) return null;
    const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
    if (!safeEqual(expected, String(sig))) return null;
    const evt = JSON.parse(rawBody.toString('utf8'));
    const pay = evt.payload?.payment?.entity;
    if (!pay) return { event: evt.event };
    return {
      event: evt.event,
      gatewayOrderId: pay.order_id,
      reference: pay.id,
      amount: pay.amount,
      instrument: pay.method,
      status: evt.event === 'payment.captured' || evt.event === 'order.paid' ? 'paid'
        : evt.event === 'payment.failed' ? 'failed' : 'pending',
    };
  },
};
