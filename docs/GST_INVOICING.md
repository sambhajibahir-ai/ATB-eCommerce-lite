# GST Invoicing

Every paid order (or confirmed COD order) gets a sequential GST **Tax Invoice** as a PDF at
`GET /api/orders/:id/invoice.pdf`, linked from the order page and Admin.

## What you need

| Detail | Env var | Notes |
|---|---|---|
| Legal / trade name | `SELLER_NAME` | Must match the GST registration |
| GSTIN | `SELLER_GSTIN` | 15 characters; the first 2 digits are the state code |
| State code + name | `SELLER_STATE_CODE`, `SELLER_STATE` | Decides CGST+SGST vs IGST |
| Registered address, email, phone | `SELLER_ADDRESS`, `SELLER_EMAIL`, `SELLER_PHONE` | Printed in the invoice header |
| Invoice series prefix | `INVOICE_PREFIX` | Final number: `INV/2026-27/00001` (≤ 16 chars, restarts every financial year) |
| Per-product **HSN code** and **GST rate** | `hsn`, `gstRate` in `server/src/data/seed.js` (or your DB) | Ask your CA for the correct HSN/rate per product |

## How tax is calculated (`server/src/services/gst.js`)

- Product prices are stored **exclusive of GST, in paise**, to avoid rounding errors.
- **Place of supply** = delivery state, or the state in the buyer's GSTIN when a B2B GSTIN is entered.
- Place of supply = seller state → **CGST + SGST** (rate split in half). Otherwise → **IGST**.
- Shipping and COD fee are taxable services (SAC **996812** @ 18%).
- The grand total is rounded to the nearest rupee; the difference is shown as *Round Off*.
- The customer can enter a **GSTIN** at checkout for a B2B invoice (format-validated).

## Steps

1. Fill in the `SELLER_*` values in `server/.env`.
2. Set the correct `hsn` and `gstRate` on every product.
3. Place a test order delivered **inside** your state and one **outside**, then check that the invoices show CGST/SGST and IGST respectively.
4. Share a sample invoice with your CA before going live.

## Optional: e-invoicing (IRN / QR code)

Businesses whose aggregate turnover exceeds the e-invoicing threshold (currently ₹5 crore) must report **B2B** invoices to the Invoice Registration Portal (IRP) and print the IRN and signed QR code. To add it:

1. Register on the e-invoice portal (https://einvoice1.gst.gov.in) and get API access, either directly or through a GST Suvidha Provider (GSP) such as ClearTax, Masters India or IRIS.
2. After `markOrderPaid` in `server/src/services/orders.js`, if `order.customer.gstin` is present, send the invoice JSON (schema INV-01) to the IRP and save the `Irn`, `AckNo` and `SignedQRCode` on the order.
3. Print the IRN and render `SignedQRCode` as a QR in `invoicePdf.js` (the `qrcode` package is already installed).

## Optional: e-way bill

Consignments of goods worth more than ₹50,000 need an e-way bill. Most couriers (and Shiprocket) can generate it when you pass the invoice details. Otherwise, generate one via the e-way bill API/GSP and send the EWB number with the shipment.

## Returns

For a refund of a paid order, issue a **credit note** that references the original invoice number. Credit notes are not generated automatically yet.
