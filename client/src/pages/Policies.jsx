// Payment gateways check for these pages during KYC. Replace the placeholder
// text with your real business details before applying for a live account.
const BUSINESS = {
  name: 'Techno Service Pvt Ltd',
  address: 'Office 101, Example Tower, Pune, Maharashtra 411001',
  email: 'support@example.com',
  phone: '+91-9000000000',
};

export default function Policies() {
  return (
    <article className="policies">
      <h1>Store policies</h1>
      <nav className="muted small">
        <a href="#terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="#refund">Refund &amp; Cancellation</a> · <a href="#shipping">Shipping</a> · <a href="#contact">Contact</a>
      </nav>

      <section id="terms" className="panel">
        <h2>Terms &amp; Conditions</h2>
        <p>This website is operated by {BUSINESS.name}. By placing an order you agree to these terms. Prices are in Indian Rupees and exclusive of GST unless stated; applicable GST is shown at checkout and on the tax invoice.</p>
      </section>

      <section id="privacy" className="panel">
        <h2>Privacy Policy</h2>
        <p>We collect your name, contact details and address only to process and deliver orders. Card and UPI details are handled by our PCI-DSS compliant payment partners and are never stored on our servers. We do not sell your data.</p>
      </section>

      <section id="refund" className="panel">
        <h2>Refund &amp; Cancellation Policy</h2>
        <p>Orders can be cancelled before dispatch for a full refund. Defective or damaged items can be returned within 7 days of delivery. Approved refunds are credited to the original payment method within 5–7 working days.</p>
      </section>

      <section id="shipping" className="panel">
        <h2>Shipping &amp; Delivery Policy</h2>
        <p>Orders are dispatched within 1–2 working days through our courier partners and usually delivered in 3–7 working days depending on the pincode. A tracking number is shared once the order ships.</p>
      </section>

      <section id="contact" className="panel">
        <h2>Contact Us</h2>
        <p>{BUSINESS.name}<br />{BUSINESS.address}<br />Email: {BUSINESS.email}<br />Phone: {BUSINESS.phone}</p>
      </section>
    </article>
  );
}
