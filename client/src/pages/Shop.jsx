import { useEffect, useState } from 'react';
import { api, rupees } from '../api.js';
import { useCart } from '../cart.jsx';

export default function Shop() {
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const { items, add } = useCart();

  useEffect(() => { api.products().then(setProducts).catch((e) => setError(e.message)); }, []);

  return (
    <>
      <h1>Shop</h1>
      {error && <p className="error">{error}</p>}
      <div className="grid">
        {products.map((p) => {
          const inCart = items[p.sku] || 0;
          return (
            <article key={p.sku} className="card">
              <img src={p.image} alt="" loading="lazy" />
              <h3>{p.name}</h3>
              <p className="muted">{p.description}</p>
              <p className="price">
                {rupees(p.pricePaise)} <span className="muted small">+ {p.gstRate}% GST</span>
              </p>
              <p className={p.stock > 5 ? 'muted small' : 'warn small'}>
                {p.stock === 0 ? 'Out of stock' : p.stock <= 5 ? `Only ${p.stock} left` : 'In stock'}
              </p>
              <button disabled={p.stock === 0 || inCart >= p.stock} onClick={() => add(p.sku, p.stock)}>
                {inCart ? `Add another (${inCart} in cart)` : 'Add to cart'}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}
