# E-commerce Store (Node.js + React)

A branded online store with:

- **UPI, card & wallet checkout** through Razorpay or Cashfree, plus direct UPI QR and Cash on Delivery
- **GST invoices**: sequential per financial year, CGST/SGST vs IGST, HSN/SAC, PDF download
- **Courier integration**: Shiprocket serviceability, AWB creation, tracking
- **Inventory sync**: pull and push with your billing software, plus a sale push back to billing

Runs out of the box in **mock mode**: every integration without credentials is simulated, so you can click through the whole flow before you have any keys.

## Quick start

Requires Node.js 18+.

```bash
npm run install:all                     # installs root, server and client packages
cp server/.env.example server/.env      # then fill in what you have
npm run dev                             # API on :5000, storefront on :5173
```

Open http://localhost:5173. Admin is at `/admin` (token = `ADMIN_TOKEN` in `server/.env`).

Production: `npm run build && npm start` serves the built React app from the Express server on `PORT`.

## Deploy to Vercel

The project is preconfigured for unified Vercel deployment (Vite React frontend + Express serverless API) via `vercel.json` and `api/index.js`.

### Quick Steps:
1. Push this repository to GitHub / GitLab / Bitbucket.
2. In the [Vercel Dashboard](https://vercel.com), click **Add New Project** and select your repository.
3. Keep default settings (the `vercel.json` handles build commands and output routing automatically).
4. In **Environment Variables**, add any required secrets (see `server/.env.example`):
   - `ADMIN_TOKEN`: Your secret token for the admin panel.
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, etc. (leave blank to run in mock mode).
   - *(Note: `CLIENT_URL` and `SERVER_URL` automatically default to your Vercel URL `https://your-project.vercel.app` if left blank).*
5. Click **Deploy**.

> [!NOTE]
> On Vercel, serverless function runtimes use an ephemeral filesystem. The built-in JSON database safely writes to `/tmp` and seeds catalog items automatically. For production data persistence across serverless cold starts, migrate `server/src/db.js` to an external database (e.g. Supabase, Neon Postgres, or MongoDB Atlas).

## What to fill in to make each feature live

| Feature | Minimum details needed | Guide |
|---|---|---|
| UPI + cards + wallets + netbanking (Razorpay) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, KYC-approved account | [docs/PAYMENT_INTEGRATION.md §3](docs/PAYMENT_INTEGRATION.md#3-razorpay-upi-cards-wallets-netbanking-emi) |
| UPI + cards + wallets + netbanking (Cashfree) | `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV`, whitelisted domain | [§4](docs/PAYMENT_INTEGRATION.md#4-cashfree-payments-upi-cards-wallets-netbanking) |
| Direct UPI (no gateway) | `UPI_VPA` (merchant VPA), `UPI_PAYEE_NAME` | [§5](docs/PAYMENT_INTEGRATION.md#5-direct-upi-your-own-vpa-zero-gateway-fee) |
| Cash on Delivery | `COD_MAX_ORDER_RUPEES`, `COD_FEE_RUPEES`, COD enabled at courier | [§6](docs/PAYMENT_INTEGRATION.md#6-cash-on-delivery) |
| GST invoices | `SELLER_GSTIN`, `SELLER_STATE_CODE`, name/address, product HSN + GST rate | [docs/GST_INVOICING.md](docs/GST_INVOICING.md) |
| Courier | `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION` | [docs/COURIER_INTEGRATION.md](docs/COURIER_INTEGRATION.md) |
| Inventory sync | `INVENTORY_PULL_URL` and/or `INVENTORY_WEBHOOK_SECRET`, `BILLING_SALE_WEBHOOK_URL` | [docs/INVENTORY_SYNC.md](docs/INVENTORY_SYNC.md) |
| Everything | Public **HTTPS** domain (webhooks + gateway KYC), policy pages at `/policies` | [Go-live checklist](docs/PAYMENT_INTEGRATION.md#8-go-live-checklist) |

## Project layout

```
server/                     Express API (ES modules)
  src/index.js              app setup, raw-body webhooks, static client
  src/config.js             all env vars in one place
  src/db.js                 JSON-file store (swap for a real DB in production)
  src/routes/               store.js (public API), webhooks.js, admin.js
  src/services/payments/    razorpay.js, cashfree.js, upiDirect.js, index.js (provider switch + mock)
  src/services/gst.js       GST maths, invoice numbering
  src/services/invoicePdf.js  PDF tax invoice
  src/services/shiprocket.js  courier API
  src/services/inventorySync.js  pull / push / sale-push
  src/services/orders.js    order lifecycle (create → paid → shipped → delivered)
client/                     React + Vite storefront
  src/pages/                Shop, Cart, Checkout, Order, Admin, Policies
  src/payments.js           launches Razorpay / Cashfree checkout in the browser
docs/                       integration guides
```

## Database & Storage

This project currently uses a zero-setup **file-based JSON store** for local development and testing:

- **Storage Location**: `server/data/db.json`
- **Module Interface**: `server/src/db.js`
- **Initial Seed Data**: `server/src/data/seed.js`

### What is stored:
- `products`: Product catalog, pricing (in paise), GST rates, stock levels, and package dimensions.
- `orders`: Order lifecycle records, customer address, payment signatures, and courier tracking details.
- `counters`: Sequential invoice numbering per financial year (e.g. `INV/2026-27/00001`).
- `inventoryLog`: Audit log of stock additions, deductions, and external sync events.

### Production Database Migration
For production, the file-based store in `server/src/db.js` can be replaced with an external database (e.g., PostgreSQL, MySQL, or MongoDB via Prisma/Drizzle/Mongoose). All data access is abstracted behind the exported `db` functions (`listProducts`, `getOrder`, `insertOrder`, `setStock`, etc.), so no route handlers or services need to change.

## Order lifecycle

`pending_payment` → (`payment_review` for direct UPI) → `paid` / `confirmed` (COD) → `shipped` → `delivered`
Failed or abandoned payments go to `payment_failed`, and the customer can *Retry payment* from the order page.

## Security notes

- Prices, GST and totals are always computed on the server. The browser only sends SKUs and quantities.
- Payments are confirmed only by server-side signature or status checks and signed webhooks, never by the redirect alone.
- Keep `server/.env` out of git (already in `.gitignore`), and change `ADMIN_TOKEN`.
"# ATB-eCommerce-lite" 
