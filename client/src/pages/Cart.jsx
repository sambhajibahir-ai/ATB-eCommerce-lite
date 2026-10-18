import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rupees } from '../api.js';
import { useCart } from '../cart.jsx';

export default function Cart() {
  const { items, setQty } = useCart();
  const [products, setProducts] = useState([]);

  useEffect(() => { api.products().then(setProducts).catch(() => {}); }, []);

  const rows = products.filter((p) => items[p.sku]);
  const subtotal = rows.reduce((s, p) => s + p.pricePaise * items[p.sku], 0);
  const gst = rows.reduce((s, p) => s + Math.round((p.pricePaise * items[p.sku] * p.gstRate) / 100), 0);

  if (!rows.length) return <><h1>Cart</h1><p>Your cart is empty. <Link to="/">Continue shopping</Link></p></>;

  return (
    <>
      <h1>Cart</h1>
      <table className="table">
        <thead><tr><th>Item</th><th>Price</th><th>Qty</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.sku}>
              <td>{p.name}<div className="muted small">HSN {p.hsn} · GST {p.gstRate}%</div></td>
              <td>{rupees(p.pricePaise)}</td>
              <td>
                <input type="number" min="0" max={p.stock} value={items[p.sku]} className="qty"
                  onChange={(e) => setQty(p.sku, Math.min(Number(e.target.value), p.stock))} />
              </td>
              <td className="num">{rupees(p.pricePaise * items[p.sku])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="summary">
        <div><span>Subtotal</span><span>{rupees(subtotal)}</span></div>
        <div><span>GST (estimated)</span><span>{rupees(gst)}</span></div>
        <p className="muted small">Shipping and the exact CGST/SGST or IGST split are calculated at checkout from your delivery state.</p>
        <Link to="/checkout" className="button">Proceed to checkout</Link>
      </div>
    </>
  );
}
