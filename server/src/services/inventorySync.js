// Keeps store stock in sync with your billing / accounting software
// (Tally, Zoho Books/Inventory, Busy, Marg, Vyapar, a custom POS...).
//
//   PULL  – every N minutes we GET INVENTORY_PULL_URL → [{ sku, stock }]
//   PUSH  – billing software POSTs stock changes to /api/inventory/webhook (HMAC signed)
//   SALE  – every paid/COD order is POSTed to BILLING_SALE_WEBHOOK_URL so the
//           billing software books the sale and reduces its own stock
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

export function applyStockUpdates(updates, source) {
  const result = { updated: 0, unknown: [] };
  for (const u of updates || []) {
    if (!u || typeof u.sku !== 'string' || !Number.isFinite(Number(u.stock))) continue;
    if (db.setStock(u.sku, Number(u.stock), source)) result.updated += 1;
    else result.unknown.push(u.sku);
  }
  return result;
}

export async function pullInventory() {
  if (!config.inventory.pullUrl) return { skipped: true, reason: 'INVENTORY_PULL_URL not set' };
  const res = await fetch(config.inventory.pullUrl, {
    headers: config.inventory.pullToken ? { Authorization: `Bearer ${config.inventory.pullToken}` } : {},
  });
  if (!res.ok) throw new Error(`Inventory pull failed: HTTP ${res.status}`);
  const body = await res.json();
  return applyStockUpdates(Array.isArray(body) ? body : body.items, 'pull');
}

/** Verifies X-Signature = hex(HMAC_SHA256(rawBody, INVENTORY_WEBHOOK_SECRET)). */
export function verifyInventoryWebhook(rawBody, signature) {
  if (!config.inventory.webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.inventory.webhookSecret).update(rawBody).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function pushSaleToBilling(order) {
  if (!config.inventory.saleWebhookUrl) return { skipped: true };
  const payload = {
    type: 'sale',
    orderId: order.id,
    invoiceNumber: order.invoiceNumber,
    invoiceDate: order.invoiceDate,
    paymentMethod: order.paymentMethod,
    paymentReference: order.payment?.reference,
    customer: order.customer,
    placeOfSupply: order.address.stateCode,
    items: order.totals.items.map((i) => ({
      sku: i.sku, name: i.name, hsn: i.hsn, qty: i.qty, rate: i.unitPaise / 100, gstRate: i.gstRate,
      taxable: i.taxablePaise / 100, cgst: i.cgstPaise / 100, sgst: i.sgstPaise / 100, igst: i.igstPaise / 100,
    })),
    grandTotal: order.totals.grandTotalPaise / 100,
  };
  const res = await fetch(config.inventory.saleWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.inventory.saleWebhookToken ? { Authorization: `Bearer ${config.inventory.saleWebhookToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Billing sale push failed: HTTP ${res.status}`);
  return { pushed: true };
}

export function startInventoryScheduler() {
  const min = config.inventory.pullIntervalMin;
  if (!config.inventory.pullUrl || !min) return;
  const run = () => pullInventory()
    .then((r) => console.log('[inventory] pull', r))
    .catch((e) => console.error('[inventory] pull error:', e.message));
  run();
  setInterval(run, min * 60 * 1000).unref();
}
