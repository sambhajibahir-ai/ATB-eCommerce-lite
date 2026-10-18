# Courier Integration (Shiprocket)

The store uses **Shiprocket**, an aggregator. One API gives you Delhivery, Blue Dart, Xpressbees, Ekart, DTDC, Shadowfax and others, with COD support, pincode serviceability, AWB generation, labels and tracking. Without credentials the app returns **mock** shipments so you can test the flow.

## What you need

| Detail | Where to get it | Env var |
|---|---|---|
| API user email + password | Shiprocket → Settings → API → *Add New API User* (use a different email from your main login) | `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` |
| Pickup location nickname | Settings → Pickup Addresses (must match **exactly**, e.g. `Primary`) | `SHIPROCKET_PICKUP_LOCATION` |
| Pickup pincode | Same address | `SHIPROCKET_PICKUP_PINCODE` |
| Auto-create shipment on payment | `true` / `false` | `SHIPROCKET_AUTO_CREATE` |
| Shipping charges shown to customers | Your choice | `FREE_SHIPPING_ABOVE_RUPEES`, `FLAT_SHIPPING_RUPEES` |

## Steps

1. Sign up at https://app.shiprocket.in/register and complete KYC (PAN, GST, bank account for COD remittance).
2. Add and verify a **pickup address**.
3. Recharge the shipping wallet. Shipments are deducted from it.
4. Create an **API user** (Settings → API) and put its credentials in `server/.env`.
5. Put correct `weightKg` and `dims` (cm) on each product. Couriers bill on the higher of actual and volumetric weight.
6. Restart the server. The log should show `shiprocket: LIVE`.
7. Test:
   - Checkout: entering a pincode calls `GET /api/shipping/serviceability` and shows the ETA, or a "not serviceable" message.
   - Admin → *Create shipment* on a paid order calls `orders/create/adhoc`, then `courier/assign/awb`, and saves the AWB.
   - The order page shows live tracking from `courier/track/awb/{awb}`.
8. Print labels and schedule pickups from the Shiprocket panel, or extend `shiprocket.js` with `courier/generate/label` and `courier/generate/pickup`.

## API calls used (`server/src/services/shiprocket.js`)

| Purpose | Endpoint |
|---|---|
| Auth (token valid ~10 days, cached) | `POST /v1/external/auth/login` |
| Serviceability / rates | `GET /v1/external/courier/serviceability/` |
| Create order | `POST /v1/external/orders/create/adhoc` |
| Assign AWB | `POST /v1/external/courier/assign/awb` |
| Track | `GET /v1/external/courier/track/awb/{awb}` |

## Using a courier directly (Delhivery, Blue Dart…)

If you have a direct contract, implement the same four functions (`serviceability`, `createShipment`, `track`, `live`) against that courier's API in a new service file, and import it in `services/orders.js` and `routes/store.js` instead of `shiprocket`.

## Status updates by webhook (optional)

Shiprocket can POST tracking updates to a URL (Settings → API → Webhooks). Add a route that finds the order by AWB and sets `status: 'delivered'` when the event says delivered. This also closes COD orders automatically.
