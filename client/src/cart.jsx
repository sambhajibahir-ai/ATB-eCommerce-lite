import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const CartContext = createContext(null);
const KEY = 'cart:v1';

function readCart() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(readCart); // { [sku]: qty }

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage unavailable */ }
  }, [items]);

  const value = useMemo(() => ({
    items,
    count: Object.values(items).reduce((a, b) => a + b, 0),
    add: (sku, max) => setItems((c) => ({ ...c, [sku]: Math.min((c[sku] || 0) + 1, max) })),
    setQty: (sku, qty) => setItems((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[sku]; else next[sku] = qty;
      return next;
    }),
    clear: () => setItems({}),
  }), [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
