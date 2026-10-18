import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useCart } from '../cart.jsx';
import { launchPayment } from '../payments.js';

const empty = { name: '', email: '', phone: '', gstin: '', line1: '', city: '', pincode: '', stateCode: '27' };

export default function Checkout() {
  const { items, clear } = useCart();
  const navigate = useNavigate();
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState(empty);
  const [method, setMethod] = useState('');
  const [ship, setShip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.config().then((c) => { setCfg(c); setMethod(c.paymentMethods[0]?.id || ''); }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!/^\d{6}$/.test(form.pincode)) { setShip(null); return; }
    api.serviceability(form.pincode, method === 'cod').then(setShip).catch(() => setShip(null));
  }, [form.pincode, method]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { order, payment } = await api.createOrder({
        items: Object.entries(items).map(([sku, qty]) => ({ sku, qty })),
        customer: { name: form.name, email: form.email, phone: form.phone, gstin: form.gstin || undefined },
        address: { line1: form.line1, city: form.city, pincode: form.pincode, stateCode: form.stateCode },
        paymentMethod: method,
      });
      clear();
      const next = await launchPayment(order, payment);
      navigate(next.navigate, { state: next.state });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!Object.keys(items).length) return <><h1>Checkout</h1><p>Your cart is empty.</p></>;
  if (!cfg) return <p>{error || 'Loading…'}</p>;

  return (
    <>
      <h1>Checkout</h1>
      <form className="form" onSubmit={submit}>
        <fieldset>
          <legend>Contact</legend>
          <label>Full name<input required value={form.name} onChange={set('name')} /></label>
          <label>Email<input required type="email" value={form.email} onChange={set('email')} /></label>
          <label>Mobile (10 digits)<input required inputMode="tel" pattern="(\+91)?[6-9][0-9]{9}" value={form.phone} onChange={set('phone')} /></label>
          <label>GSTIN (optional, for B2B invoice)<input value={form.gstin} maxLength={15} onChange={set('gstin')} /></label>
        </fieldset>

        <fieldset>
          <legend>Delivery address</legend>
          <label>Address<input required value={form.line1} onChange={set('line1')} /></label>
          <label>City<input required value={form.city} onChange={set('city')} /></label>
          <label>Pincode<input required inputMode="numeric" pattern="[0-9]{6}" value={form.pincode} onChange={set('pincode')} /></label>
          <label>State
            <select value={form.stateCode} onChange={set('stateCode')}>
              {Object.entries(cfg.states).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          {ship && (
            <p className={ship.serviceable ? 'muted small' : 'error small'}>
              {ship.serviceable
                ? `Delivers in ~${Math.min(...ship.couriers.map((c) => c.etdDays))} days${ship.mock ? ' (mock courier)' : ''}`
                : 'Sorry, we do not deliver to this pincode yet.'}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>Payment</legend>
          {cfg.paymentMethods.map((m) => (
            <label key={m.id} className="radio">
              <input type="radio" name="pm" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} />
              {m.label}
              {!m.live && <span className="badge">test mode</span>}
            </label>
          ))}
        </fieldset>

        {error && <p className="error">{error}</p>}
        <button disabled={busy || !method || ship?.serviceable === false}>{busy ? 'Please wait…' : 'Place order & pay'}</button>
      </form>
    </>
  );
}
