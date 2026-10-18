import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rupees } from '../api.js';

const TOKEN_KEY = 'admin-token';
const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };

export default function Admin() {
  const [token, setToken] = useState(readToken);
  const [orders, setOrders] = useState(null);
  const [msg, setMsg] = useState('');

  const client = api.admin(token);
  const load = useCallback(() => {
    if (!token) return;
    api.admin(token).orders().then(setOrders).catch((e) => { setOrders(null); setMsg(e.message); });
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const act = (fn) => async () => {
    setMsg('');
    try {
      const r = await fn();
      if (r?.skipped) setMsg(r.reason || 'Skipped');
      else if (r?.updated !== undefined) setMsg(`Inventory: ${r.updated} SKUs updated`);
      else setMsg('Done');
      load();
    }
    catch (e) { setMsg(e.message); }
  };

  if (!orders) {
    return (
      <form className="form narrow" onSubmit={(e) => {
        e.preventDefault();
        const t = new FormData(e.target).get('token');
        try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
        setToken(t);
      }}>
        <h1>Admin</h1>
        <label>Admin token (ADMIN_TOKEN in server/.env)<input name="token" type="password" defaultValue={token} required /></label>
        {msg && <p className="error">{msg}</p>}
        <button>Sign in</button>
      </form>
    );
  }

  return (
    <>
      <h1>Orders</h1>
      <p>
        <button onClick={act(client.syncInventory)}>Pull stock from billing software</button>{' '}
        <button className="secondary" onClick={load}>Refresh</button>
      </p>
      {msg && <p className="muted">{msg}</p>}
      <table className="table">
        <thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Status</th><th className="num">Total</th><th>Actions</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><Link to={`/order/${o.id}`}>{o.id.slice(0, 8).toUpperCase()}</Link><div className="muted small">{new Date(o.createdAt).toLocaleString('en-IN')}</div></td>
              <td>{o.customer.name}<div className="muted small">{o.address.city} {o.address.pincode}</div></td>
              <td>{o.paymentMethod}{o.payment.reference && <div className="muted small">{o.payment.reference}</div>}</td>
              <td>{o.status}{o.shipment?.awb && <div className="muted small">AWB {o.shipment.awb}</div>}</td>
              <td className="num">{rupees(o.totals.grandTotalPaise)}</td>
              <td className="actions">
                {o.status === 'payment_review' && <>
                  <button onClick={act(() => client.confirmUpi(o.id, true))}>Confirm UTR</button>
                  <button className="secondary" onClick={act(() => client.confirmUpi(o.id, false))}>Reject</button>
                </>}
                {['paid', 'confirmed'].includes(o.status) && <button onClick={act(() => client.ship(o.id))}>Create shipment</button>}
                {o.status === 'shipped' && <button className="secondary" onClick={act(() => client.delivered(o.id))}>Mark delivered</button>}
                {o.invoiceNumber && <a href={`/api/orders/${o.id}/invoice.pdf`} target="_blank" rel="noreferrer">Invoice</a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!orders.length && <p className="muted">No orders yet.</p>}
    </>
  );
}
