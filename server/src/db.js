// Minimal JSON-file store so the project runs with zero setup.
// For production, swap this module for PostgreSQL/MySQL/MongoDB — every
// other module only uses the functions exported here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedProducts } from './data/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localDataDir = path.resolve(__dirname, '../data');
const localDbFile = path.join(localDataDir, 'db.json');

// On Vercel / serverless (or when local directory is read-only), store state in os.tmpdir()
const isVercel = Boolean(process.env.VERCEL);
let dataDir = localDataDir;
let dbFile = localDbFile;

if (isVercel) {
  dataDir = os.tmpdir();
  dbFile = path.join(dataDir, 'ecommerce-store-db.json');
} else {
  try {
    if (!fs.existsSync(localDataDir)) {
      fs.mkdirSync(localDataDir, { recursive: true });
    }
    fs.accessSync(localDataDir, fs.constants.W_OK);
  } catch {
    dataDir = os.tmpdir();
    dbFile = path.join(dataDir, 'ecommerce-store-db.json');
  }
}

function load() {
  try {
    if (fs.existsSync(dbFile)) {
      return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    }
    // If running in /tmp, check if we have a bundled local db.json to seed from
    if (dbFile !== localDbFile && fs.existsSync(localDbFile)) {
      try {
        return JSON.parse(fs.readFileSync(localDbFile, 'utf8'));
      } catch (err) {
        console.warn('[db] Could not read bundled db.json:', err.message);
      }
    }
  } catch (err) {
    console.warn('[db] Failed reading db file, falling back to seed data:', err.message);
  }
  return { products: seedProducts, orders: [], counters: {}, inventoryLog: [] };
}

const state = load();

function persist() {
  try {
    const dir = path.dirname(dbFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${dbFile}.${Date.now()}-${Math.random().toString(36).slice(2, 6)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, dbFile);
  } catch (err) {
    console.warn('[db] Could not persist to disk (in-memory state preserved):', err.message);
  }
}
persist();

export const db = {
  // Products
  listProducts: () => state.products.filter((p) => p.active !== false),
  getProductBySku: (sku) => state.products.find((p) => p.sku === sku),
  setStock(sku, stock, source) {
    const p = state.products.find((x) => x.sku === sku);
    if (!p) return false;
    const before = p.stock;
    p.stock = Math.max(0, Math.floor(stock));
    state.inventoryLog.unshift({ at: new Date().toISOString(), sku, before, after: p.stock, source });
    state.inventoryLog = state.inventoryLog.slice(0, 500);
    persist();
    return true;
  },
  adjustStock(sku, delta, source) {
    const p = state.products.find((x) => x.sku === sku);
    if (!p) return false;
    return db.setStock(sku, p.stock + delta, source);
  },
  inventoryLog: () => state.inventoryLog,

  // Orders
  insertOrder(order) {
    state.orders.unshift(order);
    persist();
    return order;
  },
  getOrder: (id) => state.orders.find((o) => o.id === id),
  findOrder: (fn) => state.orders.find(fn),
  listOrders: () => state.orders,
  updateOrder(id, patch) {
    const o = state.orders.find((x) => x.id === id);
    if (!o) return null;
    Object.assign(o, patch, { updatedAt: new Date().toISOString() });
    persist();
    return o;
  },

  // Sequential counters (invoice numbers per financial year)
  nextCounter(key) {
    state.counters[key] = (state.counters[key] || 0) + 1;
    persist();
    return state.counters[key];
  },
};
