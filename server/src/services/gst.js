import { config } from '../config.js';
import { db } from '../db.js';

// GST state codes (first two digits of a GSTIN) — used as "Place of Supply".
export const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const isValidGstin = (g) => GSTIN_RE.test(String(g || '').toUpperCase());

// Shipping is a service: SAC 996812 (courier services), 18% GST.
const SHIPPING_SAC = '996812';
const SHIPPING_GST = 18;

/**
 * Build GST-compliant line items and totals.
 * Intra-state supply (seller state == place of supply) → CGST + SGST (half each).
 * Inter-state supply → IGST.
 * All amounts are integer paise.
 */
export function computeTotals({ lines, placeOfSupplyCode, paymentMethod }) {
  const intraState = placeOfSupplyCode === config.seller.stateCode;

  const goodsSubtotal = lines.reduce((s, l) => s + l.unitPaise * l.qty, 0);
  const extra = [];
  const shippingPaise = goodsSubtotal >= config.shipping.freeAbovePaise ? 0 : config.shipping.flatPaise;
  if (shippingPaise) extra.push({ sku: 'SHIPPING', name: 'Shipping charges', hsn: SHIPPING_SAC, gstRate: SHIPPING_GST, unitPaise: shippingPaise, qty: 1 });
  if (paymentMethod === 'cod' && config.cod.feePaise) {
    extra.push({ sku: 'COD-FEE', name: 'Cash on delivery fee', hsn: SHIPPING_SAC, gstRate: SHIPPING_GST, unitPaise: config.cod.feePaise, qty: 1 });
  }

  const items = [...lines, ...extra].map((l) => {
    const taxable = l.unitPaise * l.qty;
    const tax = Math.round((taxable * l.gstRate) / 100);
    const cgst = intraState ? Math.floor(tax / 2) : 0;
    const sgst = intraState ? tax - cgst : 0;
    const igst = intraState ? 0 : tax;
    return { ...l, taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise: taxable + tax };
  });

  const sum = (k) => items.reduce((s, i) => s + i[k], 0);
  const exact = sum('totalPaise');
  const rounded = Math.round(exact / 100) * 100; // invoices round to the nearest rupee
  return {
    intraState,
    items,
    taxablePaise: sum('taxablePaise'),
    cgstPaise: sum('cgstPaise'),
    sgstPaise: sum('sgstPaise'),
    igstPaise: sum('igstPaise'),
    roundOffPaise: rounded - exact,
    grandTotalPaise: rounded,
  };
}

// Financial year runs April–March: "2026-27".
export function financialYear(date = new Date()) {
  const y = date.getFullYear();
  const start = date.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// Invoice numbers must be sequential, unique per FY and ≤ 16 characters.
export function nextInvoiceNumber() {
  const fy = financialYear();
  const n = db.nextCounter(`invoice:${fy}`);
  return `${config.seller.invoicePrefix}/${fy}/${String(n).padStart(5, '0')}`;
}
