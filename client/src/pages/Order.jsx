import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, rupees } from '../api.js';
import { launchPayment } from '../payments.js';

const STATUS_TEXT = {
  pending_payment: 'Awaiting payment',
  payment_review: 'Payment submitted — being verified',
  payment_failed: 'Payment failed',
  paid: 'Paid — preparing for dispatch',
  confirmed: 'Confirmed (Cash on Delivery)',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

export default function Order() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [payment, setPayment] = useState(location.state?.payment || null);
  const [tracking, setTracking] = useState(null);
  const [utr, setUtr] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => api.order(id).then(setOrder).catch((e) => setError(e.message)), [id]);

  useEffect(() => {
    // Returning from a hosted checkout (Cashfree redirect): verify server-side.
    if (params.get('cf_return')) api.verify(id, {}).then(setOrder).catch(load);
    else load();
  }, [id, params, load]);

  // Poll while a webhook may still be on its way.
  useEffect(() => {
    if (order?.status !== 'pending_payment' && order?.status !== 'payment_review') return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [order?.status, load]);

  useEffect(() => {
    if (order?.shipment) api.tracking(id).then(setTracking).catch(() => {});
  }, [order?.shipment, id]);

  async function verify(body) {
    setError('');
    try { setOrder(await api.verify(id, body)); } catch (e) { setError(e.message); }
  }

  async function retry() {
    setError('');
    try {
      const r = await api.retry(id);
      setPayment(r.payment);
      const next = await launchPayment(r.order, r.payment);
      navigate(next.navigate, { replace: true, state: next.state });
      load();
    } catch (e) { setError(e.message); }
  }

  if (!order) return <p>{error || 'Loading…'}</p>;
  const t = order.totals;
  const awaiting = order.status === 'pending_payment';

  return (
    <>
      <h1>Order {order.id.slice(0, 8).toUpperCase()}</h1>
      <p className={`status status-${order.status}`}>{STATUS_TEXT[order.status] || order.status}</p>
      {error && <p className="error">{error}</p>}

      {awaiting && payment?.method === 'upi_direct' && (
        <section className="panel">
          <h2>Pay with any UPI app</h2>
          <img src={payment.qrDataUrl} alt="UPI QR code" width="220" height="220" />
          <p>Scan the QR, or on mobile tap <a className="button" href={payment.upiLink}>Open UPI app</a></p>
          <p className="muted small">Paying to {payment.payeeName} ({payment.vpa}) — amount {rupees(t.grandTotalPaise)}</p>
          <form onSubmit={(e) => { e.preventDefault(); verify({ utr }); }} className="inline">
            <input placeholder="12-digit UTR / UPI reference no." value={utr} onChange={(e) => setUtr(e.target.value)} pattern="[0-9]{12}" required />
            <button>I have paid</button>
          </form>
        </section>
      )}

      {awaiting && payment && !payment.live && payment.method !== 'upi_direct' && (
        <section className="panel">
          <h2>Test payment</h2>
          <p className="muted small">No gateway keys are configured for <b>{payment.method}</b>, so this is a simulated payment. Add keys in server/.env to go live.</p>
          <button onClick={() => verify({ outcome: 'success', instrument: 'upi' })}>Simulate UPI success</button>{' '}
          <button onClick={() => verify({ outcome: 'success', instrument: 'card' })}>Simulate card success</button>{' '}
          <button className="secondary" onClick={() => verify({ outcome: 'fail' })}>Simulate failure</button>
        </section>
      )}

      {(order.status === 'payment_failed' || (awaiting && !payment)) && order.paymentMethod !== 'cod' && (
        <button onClick={retry}>Retry payment</button>
      )}

      {order.invoiceNumber && (
        <p><a className="button" href={`/api/orders/${order.id}/invoice.pdf`} target="_blank" rel="noreferrer">Download GST invoice {order.invoiceNumber}</a></p>
      )}

      <section className="panel">
        <h2>Summary</h2>
        <table className="table">
          <thead><tr><th>Item</th><th>HSN/SAC</th><th>Qty</th><th className="num">Taxable</th><th className="num">{t.intraState ? 'CGST + SGST' : 'IGST'}</th><th className="num">Total</th></tr></thead>
          <tbody>
            {t.items.map((i) => (
              <tr key={i.sku}>
                <td>{i.name}</td><td>{i.hsn}</td><td>{i.qty}</td>
                <td className="num">{rupees(i.taxablePaise)}</td>
                <td className="num">{rupees(i.cgstPaise + i.sgstPaise + i.igstPaise)} <span className="muted small">@{i.gstRate}%</span></td>
                <td className="num">{rupees(i.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="summary">
          {t.roundOffPaise !== 0 && <div><span>Round off</span><span>{rupees(t.roundOffPaise)}</span></div>}
          <div className="total"><span>Grand total</span><span>{rupees(t.grandTotalPaise)}</span></div>
          {order.payment.reference && <p className="muted small">Payment ref: {order.payment.reference} {order.payment.instrument ? `(${order.payment.instrument})` : ''}</p>}
        </div>
      </section>

      {order.shipment && (
        <section className="panel">
          <h2>Shipment</h2>
          <p>{order.shipment.courier} · AWB <b>{order.shipment.awb}</b>{order.shipment.mock && ' (mock)'}</p>
          {tracking && (
            <>
              <p>Status: {tracking.status}</p>
              <ul>{tracking.events?.map((ev, k) => <li key={k} className="small">{ev.at} — {ev.activity} {ev.location && `(${ev.location})`}</li>)}</ul>
              {tracking.trackUrl && <a href={tracking.trackUrl} target="_blank" rel="noreferrer">Track on courier site</a>}
            </>
          )}
        </section>
      )}
    </>
  );
}
