import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useCart } from './cart.jsx';
import Admin from './pages/Admin.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import Order from './pages/Order.jsx';
import Policies from './pages/Policies.jsx';
import Shop from './pages/Shop.jsx';

export default function App() {
  const { count } = useCart();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">Techno Store</Link>
        <nav>
          <NavLink to="/" end>Shop</NavLink>
          <NavLink to="/cart">Cart{count ? ` (${count})` : ''}</NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Shop />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order/:id" element={<Order />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/policies" element={<Policies />} />
        </Routes>
      </main>
      <footer className="footer">
        <p>UPI, card &amp; wallet checkout · GST invoices · Courier integrations · Inventory sync</p>
        <p>
          <Link to="/policies#terms">Terms</Link> · <Link to="/policies#privacy">Privacy</Link> ·{' '}
          <Link to="/policies#refund">Refunds</Link> · <Link to="/policies#shipping">Shipping</Link> ·{' '}
          <Link to="/policies#contact">Contact</Link>
        </p>
      </footer>
    </>
  );
}
