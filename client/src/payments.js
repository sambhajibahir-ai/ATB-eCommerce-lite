// Launches the right checkout for each gateway. The server has already created
// the gateway order; the browser only opens the payment UI and reports back.
import { api } from './api.js';

const loaded = {};
function loadScript(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete loaded[src]; reject(new Error(`Could not load ${src}`)); };
    document.body.appendChild(s);
  });
  return loaded[src];
}

/**
 * @returns {Promise<{ navigate: string, state?: object }>} where to go next
 */
export async function launchPayment(order, payment) {
  const orderUrl = `/order/${order.id}`;

  // Mock mode (no keys configured) and direct UPI render their UI on the order page.
  if (payment.method === 'cod') return { navigate: orderUrl };
  if (!payment.live || payment.mock || payment.method === 'upi_direct') return { navigate: orderUrl, state: { payment } };

  if (payment.method === 'razorpay') {
    await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    return new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: payment.keyId,
        order_id: payment.razorpayOrderId,
        amount: payment.amount,
        currency: payment.currency,
        name: payment.name,
        description: `Order ${order.id.slice(0, 8).toUpperCase()}`,
        prefill: payment.prefill,
        theme: { color: '#1f5eff' },
        handler: async (resp) => {
          try { await api.verify(order.id, resp); } catch { /* webhook will reconcile */ }
          resolve({ navigate: orderUrl });
        },
        modal: { ondismiss: () => resolve({ navigate: orderUrl }) },
      });
      rzp.on('payment.failed', () => { /* customer can retry inside the modal */ });
      rzp.open();
    });
  }

  if (payment.method === 'cashfree') {
    await loadScript('https://sdk.cashfree.com/js/v3/cashfree.js');
    const cashfree = window.Cashfree({ mode: payment.mode });
    // Redirects to return_url (/order/:id?cf_return=1); the order page then verifies.
    await cashfree.checkout({ paymentSessionId: payment.paymentSessionId, redirectTarget: '_self' });
    return { navigate: orderUrl };
  }

  throw new Error(`Unsupported payment method ${payment.method}`);
}
