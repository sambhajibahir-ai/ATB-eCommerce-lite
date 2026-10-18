# Payment Integration Guide — UPI, Cards, Wallets, Netbanking, COD

This guide covers every payment method the store supports: what you need from the business side, which keys go where, how to test, and how to go live.

| Method in app (`PAYMENT_METHODS`) | Instruments customers get | Confirmation | Needs a gateway account? |
|---|---|---|---|
| `razorpay` | UPI (QR / intent / UPI ID), Credit & Debit cards, Wallets, Netbanking, EMI, Pay Later | Automatic (signature + webhook) | Yes, Razorpay |
| `cashfree` | UPI, Cards, Wallets, Netbanking, Pay Later, EMI | Automatic (status API + webhook) | Yes, Cashfree Payments |
| `upi_direct` | UPI only, paid straight to your own business VPA | Manual (customer submits UTR, admin confirms) | No, only a business bank VPA |
| `cod` | Cash / UPI to courier on delivery | Courier remits | No (courier must offer COD) |
| `mock` | Simulated | Instant | No (development only) |

> **You only need one gateway.** Razorpay or Cashfree alone covers UPI, cards and wallets. Enabling both gives you a fallback if one has downtime. `upi_direct` is for zero-fee UPI when you can live with manual reconciliation.

---

## 0. How the payment flow works

```
Browser                         Our API (server/)                       Gateway
───────                         ─────────────────                       ───────
1. Place order ───────────────▶ POST /api/orders
                                  • re-prices cart from DB (never trusts client)
                                  • computes GST, checks stock
                                  • creates gateway order ─────────────▶ Create order API
                                ◀─ order + checkout params ◀─────────── order id / session id
2. Opens gateway checkout ─────────────────────────────────────────────▶ customer pays (UPI/card/wallet)
3. Checkout returns ──────────▶ POST /api/orders/:id/verify
                                  • Razorpay: HMAC signature + fetch payment
                                  • Cashfree: fetch order status
                                  • marks PAID → stock −qty, GST invoice no.,
                                    sale pushed to billing, (optional) shipment
4. (async)                      POST /api/webhooks/<gateway>  ◀──────── webhook (source of truth)
                                  • verifies signature, marks PAID if step 3 never arrived
```

Steps 3 and 4 are **idempotent**: whichever arrives first marks the order paid, the other is a no-op. This matters because customers often close the tab right after paying via UPI. The webhook still completes the order.

Code map:

| File | Responsibility |
|---|---|
| `server/src/services/payments/razorpay.js` | Create order, verify signature, parse webhook |
| `server/src/services/payments/cashfree.js` | Create order/session, verify status, parse webhook |
| `server/src/services/payments/upiDirect.js` | Build `upi://pay` link + QR, accept UTR |
| `server/src/services/payments/index.js` | Picks the provider; falls back to **mock** when keys are missing |
| `server/src/routes/store.js` | `/orders`, `/orders/:id/verify`, `/orders/:id/retry` |
| `server/src/routes/webhooks.js` | `/webhooks/razorpay`, `/webhooks/cashfree` (raw body) |
| `client/src/payments.js` | Loads Razorpay Checkout / Cashfree JS SDK in the browser |

---

## 1. Business prerequisites (collect these first)

Gateways run KYC before they activate live payments. Have these ready; the exact list varies by business type.

| Item | Proprietorship | Partnership / LLP | Pvt Ltd |
|---|---|---|---|
| PAN | Proprietor's PAN | Firm PAN | Company PAN |
| Business proof | GST certificate **or** Shop & Establishment / Udyam certificate | Partnership deed / LLP agreement + registration | Certificate of Incorporation, MoA, AoA |
| GSTIN | Needed for GST invoices (this app prints it) | ✓ | ✓ |
| Bank account in business name | Cancelled cheque or bank statement | ✓ | ✓ |
| Authorised signatory KYC | Aadhaar / passport / voter ID of proprietor | Partners' KYC | Directors' KYC + board resolution (sometimes) |
| Business address proof | Utility bill / rent agreement | ✓ | ✓ |

**Website requirements** (reviewers open your site and check these):

- [ ] Site is live on a public **HTTPS** domain (not `localhost`, not "coming soon").
- [ ] Products with **prices in INR** are visible.
- [ ] Policy pages are linked in the footer: **Terms & Conditions, Privacy Policy, Refund & Cancellation, Shipping & Delivery, Contact Us** (with a physical address, email and phone). This app ships editable versions at `/policies`. Replace the placeholder text in `client/src/pages/Policies.jsx`.
- [ ] Business name on the site matches the name on the KYC documents / bank account.
- [ ] No prohibited products (see each gateway's restricted list).

---

## 2. Common setup (all methods)

1. Copy the env template:
   ```bash
   cp server/.env.example server/.env
   ```
2. Fill in **seller / GST** values (`SELLER_*`). These are printed on every invoice.
3. Set `PAYMENT_METHODS` to the methods you want at checkout, in display order, e.g.
   `PAYMENT_METHODS=razorpay,upi_direct,cod`.
4. Set `SERVER_URL` to the public HTTPS URL of the API and `CLIENT_URL` to the storefront URL.
5. **Webhooks need a public URL.** For local testing, expose port 5000 with a tunnel:
   ```bash
   npx cloudflared tunnel --url http://localhost:5000
   # or: ngrok http 5000
   ```
   Use the printed `https://…` URL as `SERVER_URL` and in the gateway's webhook settings.
6. Restart the server. The startup log shows which methods are `LIVE` and which are `mock`:
   ```
   razorpay: LIVE | cashfree: mock (sandbox) | upi_direct: LIVE | shiprocket: mock
   ```

---

## 3. Razorpay: UPI, Cards, Wallets, Netbanking, EMI

### 3.1 What you need

| Detail | Where to get it | Env var |
|---|---|---|
| Key ID (`rzp_test_…` / `rzp_live_…`) | Dashboard → Account & Settings → API Keys → Generate | `RAZORPAY_KEY_ID` |
| Key Secret | Shown **once** when generating the key; store it safely | `RAZORPAY_KEY_SECRET` |
| Webhook secret | Any strong random string you type when creating the webhook | `RAZORPAY_WEBHOOK_SECRET` |

### 3.2 Steps

1. **Sign up** at https://dashboard.razorpay.com/signup with the business email and mobile.
2. **Test mode first.** Toggle to *Test Mode* (top bar). Generate **test** API keys and put them in `server/.env`:
   ```env
   PAYMENT_METHODS=razorpay,cod
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. **Create the webhook** (Account & Settings → Webhooks → *Add New Webhook*):
   - URL: `https://<SERVER_URL>/api/webhooks/razorpay`
   - Secret: a long random string, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, and the same value in `RAZORPAY_WEBHOOK_SECRET`
   - Active events: **`payment.captured`**, **`payment.failed`**, **`order.paid`**
4. **Payment capture:** keep *Automatic capture* ON (Account & Settings → Payment Capture). The code also captures `authorized` payments itself as a fallback.
5. **Run a test payment:** `npm run dev`, add items, choose *UPI / Cards / Wallets / Netbanking (Razorpay)*.
   - **UPI:** enter UPI ID `success@razorpay` (succeeds) or `failure@razorpay` (fails).
   - **Cards / Netbanking / Wallets:** use the test instruments at https://razorpay.com/docs/payments/payments/test-card-details/. Netbanking and wallets show a *Success / Failure* simulator page in test mode.
6. **Check it worked:** the order page shows *Paid*, *Download GST invoice* is available, stock dropped by the ordered quantity, and Dashboard → Webhooks shows a `200` delivery.
7. **Complete KYC / activation:** Dashboard → *Activate account*, then submit the documents from §1. Approval typically takes 2–5 working days.
8. **Enable instruments** (Account & Settings → Payment Methods): UPI, cards, netbanking are on by default. Request activation for **wallets**, **EMI**, **Pay Later**, **international cards** (extra review) and **Amex/Diners** if you need them.
9. **Go live:** switch to *Live Mode*, generate **live** keys, create the **same webhook again in live mode** (test and live webhooks are separate), update `.env`, restart.

### 3.3 Per-instrument notes

| Instrument | Notes |
|---|---|
| **UPI** | Checkout shows a QR on desktop and an app list (GPay, PhonePe, Paytm, BHIM…) on mobile (intent flow). Always rely on the webhook. UPI apps may not return to the browser. |
| **Cards** | Card data never touches your server (Razorpay is PCI-DSS compliant), so you need no PCI certification. Saved cards use RBI-mandated tokenisation. Enable it from the dashboard if you want card saving. |
| **Wallets** | Available wallets depend on what is activated for your account (e.g. Amazon Pay, Mobikwik, Freecharge). Some need separate approval. |
| **Netbanking** | 50+ banks, enabled by default. |
| **EMI / Pay Later** | Separate activation; usually a minimum order value applies. |

### 3.4 How the code verifies payment

- Server creates the order: `POST https://api.razorpay.com/v1/orders` with `amount` in **paise**.
- Checkout returns `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`.
- Server checks `HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET) == signature`, then fetches the payment to confirm `status=captured` and `amount` matches.
- Webhook checks `X-Razorpay-Signature == HMAC_SHA256(raw_body, WEBHOOK_SECRET)`.

---

## 4. Cashfree Payments: UPI, Cards, Wallets, Netbanking

### 4.1 What you need

| Detail | Where to get it | Env var |
|---|---|---|
| App ID (Client ID) | Merchant Dashboard → Developers → API Keys | `CASHFREE_APP_ID` |
| Secret Key | Same page (sandbox and production keys are different) | `CASHFREE_SECRET_KEY` |
| Environment | `sandbox` while testing, `production` when live | `CASHFREE_ENV` |

The webhook signature uses the same **Secret Key**, so no separate webhook secret is needed.

### 4.2 Steps

1. **Sign up** at https://merchant.cashfree.com/merchants/signup and select *Payment Gateway*.
2. Switch to **Test/Sandbox** environment and copy the sandbox keys:
   ```env
   PAYMENT_METHODS=cashfree,cod
   CASHFREE_APP_ID=TEST1234567890abcdef
   CASHFREE_SECRET_KEY=cfsk_ma_test_xxxxxxxxxxxxxxxx
   CASHFREE_ENV=sandbox
   ```
3. **Whitelist your domain** (Developers → Whitelisting). Production checkout only works on approved domains. Add your storefront domain.
4. **Webhook:** The app sends `notify_url = <SERVER_URL>/api/webhooks/cashfree` on every order, so no dashboard setup is strictly required. You can also add it under Developers → Webhooks (version **2023-08-01**) as a backup.
5. **Test:** choose *UPI / Cards / Wallets / Netbanking (Cashfree)* at checkout. You are redirected to Cashfree's page, then back to `/order/<id>?cf_return=1`, where the app calls the status API.
   - Sandbox UPI: `testsuccess@gocash` (success) / `testfailure@gocash` (failure).
   - Test cards & netbanking: https://www.cashfree.com/docs/payments/online/resources/sandbox-environment
6. **KYC:** submit the §1 documents in the dashboard (*Activate Account*).
7. **Go live:** generate **production** keys, set `CASHFREE_ENV=production`, whitelist the production domain, restart.

### 4.3 How the code verifies payment

- `POST /pg/orders` (headers `x-client-id`, `x-client-secret`, `x-api-version: 2023-08-01`) returns `payment_session_id`.
- Browser: `Cashfree({ mode }).checkout({ paymentSessionId })` from `https://sdk.cashfree.com/js/v3/cashfree.js`.
- On return, the server calls `GET /pg/orders/{order_id}` and treats `order_status == "PAID"` as success. It never trusts the redirect alone.
- Webhook: `x-webhook-signature == base64(HMAC_SHA256(x-webhook-timestamp + raw_body, SECRET_KEY))`.
- Retries create a new Cashfree order id (`ord_<uuid>_<attempt>`) because order ids must be unique.

---

## 5. Direct UPI (your own VPA): zero gateway fee

The customer scans a QR (or taps *Open UPI app* on mobile) that pays straight into your bank account. There is **no automatic confirmation**: the customer enters the 12-digit **UTR**, and you confirm it against your bank statement in **Admin**.

### 5.1 What you need

| Detail | Where to get it | Env var |
|---|---|---|
| **Business / merchant VPA** linked to your current account | Your bank's merchant UPI / *UPI QR for business* service, or apps like PhonePe Business, Paytm for Business, BharatPe, Google Pay for Business | `UPI_VPA` |
| Payee name exactly as registered | Same | `UPI_PAYEE_NAME` |

> Use a **merchant VPA**, not a personal one. Personal VPAs have P2P limits, can be flagged for commercial use, and some UPI apps show warnings or block pre-filled amounts on P2P links.

### 5.2 Steps

1. Get a merchant VPA from your bank / PSP (KYC with GST or Udyam + PAN + current account).
2. Set:
   ```env
   PAYMENT_METHODS=razorpay,upi_direct,cod
   UPI_VPA=yourshop@okicici
   UPI_PAYEE_NAME=Techno Service
   ```
3. Test: place an order with *Pay by UPI QR*, scan with your own phone, pay a small amount, enter the UTR shown in your UPI app → order moves to **payment_review**.
4. **Reconcile:** open `/admin` → match the UTR with your bank statement / merchant app → *Confirm UTR* (marks paid, generates invoice, reduces stock) or *Reject*.

### 5.3 Link format used

```
upi://pay?pa=<VPA>&pn=<Payee Name>&am=<amount 2dp>&cu=INR&tn=<note>&tr=<order ref>
```

### 5.4 Automating confirmation (optional)

Manual review does not scale past a few dozen orders a day. To automate it, either:
- move UPI to Razorpay/Cashfree (UPI there is confirmed automatically), or
- use your bank's **merchant collection API / virtual account** that sends a callback per credit. Call `markOrderPaid(orderId, { reference: utr, via: 'bank' })` from that callback.

---

## 6. Cash on Delivery

1. Add `cod` to `PAYMENT_METHODS`.
2. Configure limits: `COD_MAX_ORDER_RUPEES` (orders above this cannot choose COD) and `COD_FEE_RUPEES` (added as a taxable line with SAC 996812 @ 18%).
3. **Enable COD on the courier side.** In Shiprocket, COD is on by default after KYC. Set the remittance cycle and bank account under *Settings → Company → Bank Details*. The app sends `payment_method: "COD"` when creating the shipment.
4. Flow: order becomes **confirmed** immediately (stock reduced, invoice issued) → ship → mark *delivered* in Admin, which marks payment captured.
5. Reduce RTO (return-to-origin) losses: keep a COD cap, add OTP/phone confirmation before shipping, and check pincode COD serviceability (checkout already calls the serviceability API with `cod=1`).

---

## 7. Testing matrix

Run each row in test mode before going live.

| # | Scenario | Expected result |
|---|---|---|
| 1 | Razorpay UPI `success@razorpay` | Order *Paid*, invoice downloadable, stock reduced |
| 2 | Razorpay UPI `failure@razorpay` | Order stays *Awaiting payment*; *Retry payment* works |
| 3 | Razorpay card success | *Paid*, `payment.instrument = card` |
| 4 | Close the browser tab right after paying | Webhook marks order *Paid* within seconds |
| 5 | Cashfree `testsuccess@gocash` | Redirect back → *Paid* |
| 6 | Cashfree payment abandoned | *Awaiting payment* → retry creates `…_2` order |
| 7 | Direct UPI with a wrong UTR format | Error "UTR must be the 12-digit…" |
| 8 | Direct UPI valid UTR → Admin *Confirm* | *Paid*, invoice issued |
| 9 | COD above `COD_MAX_ORDER_RUPEES` | Checkout error |
| 10 | Tampered webhook (wrong signature) | HTTP 400, order unchanged |
| 11 | Delivery state = seller state | Invoice shows CGST + SGST |
| 12 | Delivery state ≠ seller state | Invoice shows IGST |

Test a webhook signature failure quickly:
```bash
curl -X POST $SERVER_URL/api/webhooks/razorpay -H "X-Razorpay-Signature: bad" -d '{}'
# → {"error":"Invalid signature"}
```

---

## 8. Go-live checklist

- [ ] KYC approved and live mode activated on the gateway(s)
- [ ] **Live** keys in `server/.env` (never commit `.env`; it is in `.gitignore`)
- [ ] Live-mode webhook created with the production `SERVER_URL` and correct secret
- [ ] `CASHFREE_ENV=production` and domain whitelisted (if using Cashfree)
- [ ] Site served over HTTPS; `CLIENT_URL` / `SERVER_URL` point at production domains
- [ ] `ADMIN_TOKEN` changed to a long random value
- [ ] `mock` removed from `PAYMENT_METHODS`; the startup log shows `LIVE` for every enabled gateway
- [ ] Policy pages updated with real business details
- [ ] One real ₹1–₹10 payment per method, then a refund from the dashboard
- [ ] The JSON file store (`server/data/db.json`) replaced with a real database (PostgreSQL/MySQL) for concurrent traffic (only `server/src/db.js` needs changing)
- [ ] Backups and log monitoring for webhook failures enabled

---

## 9. Refunds

Refunds are issued from the gateway dashboard (Payments → select payment → *Refund*). They go back to the original instrument. UPI refunds are usually instant to 2 days; cards take 5–7 working days. To automate:

- Razorpay: `POST /v1/payments/{payment_id}/refund` with `{ "amount": <paise> }`
- Cashfree: `POST /pg/orders/{order_id}/refunds` with `{ "refund_amount": <rupees>, "refund_id": "<unique>" }`

For GST, issue a **credit note** against the original invoice number when refunding a paid order.

---

## 10. Adding another gateway (PhonePe PG, PayU, Paytm, CCAvenue, Stripe India)

Every provider implements the same small interface. Create `server/src/services/payments/<name>.js`:

```js
export const mygateway = {
  async initiate(order) {           // create order/session on the gateway
    return { gatewayOrderId, client: { /* params the browser needs */ } };
  },
  async verify(order, body) {       // confirm server-side, never trust the browser
    return { status: 'paid' | 'pending' | 'failed', reference, instrument };
  },
  parseWebhook(rawBody, headers) {  // verify signature, normalise event
    return { gatewayOrderId, status, reference, amount /* paise */ } | null;
  },
};
```

Then:
1. Register it in `providers` and `METHOD_LABELS` in `payments/index.js`.
2. Add an `isConfigured.<name>` check and env vars in `config.js` / `.env.example`.
3. Add a webhook route in `routes/webhooks.js` that calls `handlePaymentEvent('<name>', evt)`.
4. Add a browser launcher branch in `client/src/payments.js`.

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Method shows **"test mode"** badge | Keys for that method are missing in `server/.env`, so it is running in mock mode. |
| `Razorpay 401: Authentication failed` | Key ID/secret mismatch, or test key used in live mode (or vice versa). |
| Webhook shows 400 *Invalid signature* | Wrong `RAZORPAY_WEBHOOK_SECRET`, or a proxy re-encoded the body. Webhook routes must receive the raw body (already handled in `index.js`). |
| Order stays *Awaiting payment* after a UPI payment | Webhook not reachable: check `SERVER_URL`, tunnel/HTTPS, and delivery logs in the dashboard. |
| Cashfree `order_id already exists` | Use *Retry payment* (it increments the attempt suffix). |
| Cashfree checkout blank in production | Domain not whitelisted. |
| UPI app says *"Payment to this merchant is restricted"* on direct UPI | A personal VPA is being used for P2M. Switch to a merchant VPA. |
