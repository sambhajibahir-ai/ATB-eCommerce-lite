import PDFDocument from 'pdfkit';
import { config } from '../config.js';
import { GST_STATES } from './gst.js';

// pdfkit's built-in fonts lack the ₹ glyph, so amounts are printed as "Rs.".
const rs = (paise) => (paise / 100).toFixed(2);

function amountInWords(rupees) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? a[n] : `${b[Math.floor(n / 10)]}${n % 10 ? ` ${a[n % 10]}` : ''}`);
  const three = (n) => (n >= 100 ? `${a[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${two(n % 100)}` : ''}` : two(n));
  if (rupees === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(rupees / 1e7); rupees %= 1e7;
  const lakh = Math.floor(rupees / 1e5); rupees %= 1e5;
  const thousand = Math.floor(rupees / 1e3); rupees %= 1e3;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rupees) parts.push(three(rupees));
  return parts.join(' ');
}

/** Streams a GST tax invoice PDF for a paid/confirmed order into `stream`. */
export function writeInvoicePdf(order, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  doc.pipe(stream);
  const s = config.seller;
  const t = order.totals;
  const c = order.customer;

  doc.fontSize(16).font('Helvetica-Bold').text('TAX INVOICE', { align: 'center' });
  doc.moveDown(0.5);

  doc.fontSize(10).font('Helvetica-Bold').text(s.name);
  doc.font('Helvetica').text(s.address).text(`GSTIN: ${s.gstin}   State: ${s.state} (${s.stateCode})`);
  if (s.email || s.phone) doc.text([s.email, s.phone].filter(Boolean).join('  |  '));

  const top = doc.y + 8;
  doc.font('Helvetica-Bold').text('Invoice No:', 36, top).font('Helvetica').text(order.invoiceNumber, 110, top);
  doc.font('Helvetica-Bold').text('Invoice Date:', 36, top + 14).font('Helvetica')
    .text(new Date(order.invoiceDate).toLocaleDateString('en-IN'), 110, top + 14);
  doc.font('Helvetica-Bold').text('Order ID:', 36, top + 28).font('Helvetica').text(order.id.slice(0, 8).toUpperCase(), 110, top + 28);
  doc.font('Helvetica-Bold').text('Payment:', 36, top + 42).font('Helvetica')
    .text(`${order.paymentMethod.toUpperCase()}${order.payment?.reference ? ` (${order.payment.reference})` : ''}`, 110, top + 42);

  doc.font('Helvetica-Bold').text('Bill / Ship To:', 320, top);
  doc.font('Helvetica').text(c.name, 320, top + 14).text(order.address.line1, 320)
    .text(`${order.address.city}, ${order.address.state} - ${order.address.pincode}`, 320)
    .text(`Phone: ${c.phone}`, 320);
  if (c.gstin) doc.text(`GSTIN: ${c.gstin}`, 320);
  doc.text(`Place of Supply: ${GST_STATES[order.address.stateCode] || order.address.state} (${order.address.stateCode})`, 320);

  // Line-item table
  let y = Math.max(doc.y, top + 70) + 12;
  const cols = t.intraState
    ? [['#', 36, 20], ['Item', 56, 150], ['HSN/SAC', 206, 55], ['Qty', 261, 30], ['Rate', 291, 55], ['Taxable', 346, 60], ['CGST', 406, 55], ['SGST', 461, 55], ['Total', 516, 60]]
    : [['#', 36, 20], ['Item', 56, 180], ['HSN/SAC', 236, 55], ['Qty', 291, 30], ['Rate', 321, 60], ['Taxable', 381, 65], ['IGST', 446, 65], ['Total', 511, 65]];
  doc.rect(36, y - 4, 540, 18).fill('#eeeeee').fillColor('#000');
  doc.font('Helvetica-Bold').fontSize(8);
  cols.forEach(([h, x, w]) => doc.text(h, x + 2, y, { width: w - 4 }));
  y += 18;
  doc.font('Helvetica');
  t.items.forEach((it, i) => {
    const row = [
      String(i + 1), it.name, it.hsn, String(it.qty), rs(it.unitPaise), rs(it.taxablePaise),
      ...(t.intraState
        ? [`${rs(it.cgstPaise)} @${it.gstRate / 2}%`, `${rs(it.sgstPaise)} @${it.gstRate / 2}%`]
        : [`${rs(it.igstPaise)} @${it.gstRate}%`]),
      rs(it.totalPaise),
    ];
    cols.forEach(([, x, w], k) => doc.text(row[k], x + 2, y, { width: w - 4 }));
    y += 20;
  });
  doc.moveTo(36, y).lineTo(576, y).stroke();
  y += 8;

  const summary = [
    ['Taxable Value', t.taxablePaise],
    ...(t.intraState ? [['CGST', t.cgstPaise], ['SGST', t.sgstPaise]] : [['IGST', t.igstPaise]]),
    ['Round Off', t.roundOffPaise],
    ['Grand Total (Rs.)', t.grandTotalPaise],
  ];
  summary.forEach(([k, v], i) => {
    doc.font(i === summary.length - 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
      .text(k, 380, y, { width: 110 }).text(rs(v), 490, y, { width: 86, align: 'right' });
    y += 14;
  });
  doc.font('Helvetica').fontSize(9)
    .text(`Amount in words: Rupees ${amountInWords(Math.round(t.grandTotalPaise / 100))} Only`, 36, y + 8);
  doc.text('Tax is not payable on reverse charge basis.', 36);
  doc.moveDown(2).text(`For ${s.name}`, { align: 'right' }).moveDown(2).text('Authorised Signatory', { align: 'right' });
  doc.fontSize(7).fillColor('#666').text('This is a computer-generated invoice.', 36, 790, { align: 'center', width: 540 });
  doc.end();
}
