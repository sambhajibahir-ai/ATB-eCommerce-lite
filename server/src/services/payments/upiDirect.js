// Direct UPI to your own business VPA using the NPCI UPI deep-link spec.
// No gateway fee, but there is no automatic confirmation: the customer submits
// the 12-digit UTR and an admin confirms it against the bank statement.
import QRCode from 'qrcode';
import { config } from '../../config.js';

export const upiDirect = {
  async initiate(order) {
    const ref = order.id.replace(/-/g, '').slice(0, 20).toUpperCase();
    const params = new URLSearchParams({
      pa: config.upi.vpa,
      pn: config.upi.payeeName,
      am: (order.totals.grandTotalPaise / 100).toFixed(2),
      cu: 'INR',
      tn: `Order ${ref.slice(0, 8)}`,
      tr: ref,
    });
    const upiLink = `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
    const qrDataUrl = await QRCode.toDataURL(upiLink, { width: 260, margin: 1 });
    return { gatewayOrderId: ref, client: { upiLink, qrDataUrl, vpa: config.upi.vpa, payeeName: config.upi.payeeName } };
  },

  // Customer submits the UTR; order waits for admin confirmation.
  async verify(order, body) {
    const utr = String(body?.utr || '').trim();
    if (!/^\d{12}$/.test(utr)) return { status: 'failed', error: 'UTR must be the 12-digit UPI reference number' };
    return { status: 'review', reference: utr, instrument: 'upi' };
  },
};
