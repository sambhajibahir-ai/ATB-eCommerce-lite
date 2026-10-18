import { config, isConfigured } from '../../config.js';
import { razorpay } from './razorpay.js';
import { cashfree } from './cashfree.js';
import { upiDirect } from './upiDirect.js';

// COD needs no gateway: the order is confirmed immediately and collected by the courier.
const cod = {
  async initiate() { return { gatewayOrderId: null, client: {} }; },
  async verify() { return { status: 'cod' }; },
};

// Mock gateway: lets you run the whole flow end-to-end without any keys.
const mock = {
  async initiate(order) { return { gatewayOrderId: `mock_${order.id.slice(0, 8)}`, client: { mock: true } }; },
  async verify(order, body) {
    return body?.outcome === 'fail' ? { status: 'failed', error: 'Simulated failure' }
      : { status: 'paid', reference: `MOCK${Date.now()}`, instrument: body?.instrument || 'upi' };
  },
};

const providers = { razorpay, cashfree, upi_direct: upiDirect, cod, mock };

export const METHOD_LABELS = {
  razorpay: 'UPI / Cards / Wallets / Netbanking (Razorpay)',
  cashfree: 'UPI / Cards / Wallets / Netbanking (Cashfree)',
  upi_direct: 'Pay by UPI QR / UPI ID (direct)',
  cod: 'Cash on Delivery',
  mock: 'Test payment (mock)',
};

/** Returns the provider to use — falls back to mock when credentials are missing. */
export function getProvider(method) {
  if (!providers[method]) throw new Error(`Unknown payment method: ${method}`);
  return isConfigured[method]() ? { provider: providers[method], live: method !== 'mock' } : { provider: mock, live: false };
}

export function availableMethods() {
  return config.paymentMethods
    .filter((m) => providers[m])
    .map((m) => ({ id: m, label: METHOD_LABELS[m], live: m === 'cod' || (m !== 'mock' && isConfigured[m]()) }));
}

export { providers };
