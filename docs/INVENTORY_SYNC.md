# Inventory Sync with Billing Software

Stock stays consistent between the online store and your billing / accounting software (Tally, Zoho Books / Inventory, Busy, Marg, Vyapar, or your own POS). The link between the two systems is the **SKU**. Use the same item code in both.

```
Billing software ──(1) PULL every N min──────▶ Store      GET  INVENTORY_PULL_URL
Billing software ──(2) PUSH on every change──▶ Store      POST /api/inventory/webhook
Store ────────────(3) SALE on every paid order──▶ Billing  POST BILLING_SALE_WEBHOOK_URL
```

Use **(1)** or **(2)** (or both) so the store receives stock levels, and **(3)** so billing books online sales.

## What you need

| Detail | Env var |
|---|---|
| URL that returns current stock | `INVENTORY_PULL_URL` |
| Bearer token for that URL (optional) | `INVENTORY_PULL_TOKEN` |
| Pull interval in minutes (0 = off) | `INVENTORY_PULL_INTERVAL_MIN` |
| Shared secret to sign push webhooks | `INVENTORY_WEBHOOK_SECRET` |
| URL where the store sends each sale | `BILLING_SALE_WEBHOOK_URL` |
| Bearer token for that URL (optional) | `BILLING_SALE_WEBHOOK_TOKEN` |

## (1) Pull

The store calls `GET INVENTORY_PULL_URL` with `Authorization: Bearer <INVENTORY_PULL_TOKEN>` and expects:

```json
[{ "sku": "TS-KB-001", "stock": 24 }, { "sku": "TS-MS-002", "stock": 60 }]
```

(or `{ "items": [...] }`). It runs at startup, every `INVENTORY_PULL_INTERVAL_MIN` minutes, and when you click **Admin → Pull stock from billing software**.

## (2) Push webhook

Your billing software (or a small connector script) POSTs to `https://<SERVER_URL>/api/inventory/webhook`:

```http
POST /api/inventory/webhook
Content-Type: application/json
X-Signature: <hex HMAC-SHA256 of the raw body using INVENTORY_WEBHOOK_SECRET>

{ "items": [{ "sku": "TS-KB-001", "stock": 23 }] }
```

Generate the signature (Node):
```js
const sig = require('crypto').createHmac('sha256', SECRET).update(rawBody).digest('hex');
```
Test with curl (bash):
```bash
BODY='{"items":[{"sku":"TS-KB-001","stock":23}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$INVENTORY_WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST http://localhost:5000/api/inventory/webhook -H "Content-Type: application/json" -H "X-Signature: $SIG" -d "$BODY"
# → {"updated":1,"unknown":[]}
```

## (3) Sale push

After every paid / COD-confirmed order, the store POSTs:

```json
{
  "type": "sale", "orderId": "…", "invoiceNumber": "INV/2026-27/00001", "invoiceDate": "…",
  "paymentMethod": "razorpay", "paymentReference": "pay_…",
  "customer": { "name": "…", "email": "…", "phone": "…", "gstin": "" },
  "placeOfSupply": "27",
  "items": [{ "sku": "TS-KB-001", "name": "…", "hsn": "847160", "qty": 1, "rate": 1299, "gstRate": 18,
              "taxable": 1299, "cgst": 116.91, "sgst": 116.91, "igst": 0 }],
  "grandTotal": 1533
}
```

Your connector creates a sales voucher/invoice in the billing software, which also reduces stock there.

## Connecting specific software

| Software | How to connect |
|---|---|
| **Zoho Books / Zoho Inventory** | Pull: a small script calls Zoho's `GET /inventory/v1/items` (OAuth) and maps `sku` → `stock_on_hand`. Push: Zoho *Workflow → Webhook* on item update. Sale: create an invoice with `POST /books/v3/invoices`. |
| **Tally Prime** | Enable Tally's XML/HTTP server (F1 → Settings → Connectivity, port 9000). A connector on the Tally PC exports *Stock Summary* via XML request → pushes to the webhook, and imports sales as vouchers from the sale-push payload. Tally connectors such as Api2Books or TallyConnector can do this. |
| **Busy / Marg / Vyapar** | Use the vendor's API or scheduled Excel/CSV export. A small script reads the export and calls the push webhook. |
| **Custom POS** | Expose the pull JSON above, or call the push webhook after every POS sale. |

## Stock rules in the store

- Stock is checked when an order is placed and **reduced when payment is confirmed** (or immediately for COD).
- Incoming sync values **overwrite** store stock. Billing software is the master.
- Every change is logged (`GET /api/admin/inventory/log`) with its source: `pull`, `webhook`, `admin`, or `order:<id>`.
- For high traffic, reserve stock at order creation with an expiry, and move to a real database with row locking (see `server/src/db.js`).
