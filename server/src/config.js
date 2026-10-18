import 'dotenv/config';

const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v) => String(v).toLowerCase() === 'true';

const vercelUrl = env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null;

export const config = {
  port: num(env.PORT, 5000),
  clientUrl: env.CLIENT_URL || vercelUrl || 'http://localhost:5173',
  serverUrl: env.SERVER_URL || vercelUrl || 'http://localhost:5000',
  adminToken: env.ADMIN_TOKEN || 'change-me-admin-token',

  seller: {
    name: env.SELLER_NAME || 'Techno Service Pvt Ltd',
    gstin: env.SELLER_GSTIN || '27ABCDE1234F1Z5',
    stateCode: env.SELLER_STATE_CODE || '27',
    state: env.SELLER_STATE || 'Maharashtra',
    address: env.SELLER_ADDRESS || 'Pune, Maharashtra',
    email: env.SELLER_EMAIL || '',
    phone: env.SELLER_PHONE || '',
    invoicePrefix: env.INVOICE_PREFIX || 'INV',
  },

  paymentMethods: (env.PAYMENT_METHODS || 'razorpay,cashfree,upi_direct,cod')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  cashfree: {
    appId: env.CASHFREE_APP_ID || '',
    secretKey: env.CASHFREE_SECRET_KEY || '',
    env: env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox',
  },
  upi: {
    vpa: env.UPI_VPA || '',
    payeeName: env.UPI_PAYEE_NAME || 'Store',
  },
  cod: {
    maxOrderPaise: num(env.COD_MAX_ORDER_RUPEES, 5000) * 100,
    feePaise: num(env.COD_FEE_RUPEES, 40) * 100,
  },
  shipping: {
    email: env.SHIPROCKET_EMAIL || '',
    password: env.SHIPROCKET_PASSWORD || '',
    pickupLocation: env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
    pickupPincode: env.SHIPROCKET_PICKUP_PINCODE || '411001',
    autoCreate: bool(env.SHIPROCKET_AUTO_CREATE),
    freeAbovePaise: num(env.FREE_SHIPPING_ABOVE_RUPEES, 999) * 100,
    flatPaise: num(env.FLAT_SHIPPING_RUPEES, 49) * 100,
  },
  inventory: {
    pullUrl: env.INVENTORY_PULL_URL || '',
    pullToken: env.INVENTORY_PULL_TOKEN || '',
    pullIntervalMin: num(env.INVENTORY_PULL_INTERVAL_MIN, 15),
    webhookSecret: env.INVENTORY_WEBHOOK_SECRET || '',
    saleWebhookUrl: env.BILLING_SALE_WEBHOOK_URL || '',
    saleWebhookToken: env.BILLING_SALE_WEBHOOK_TOKEN || '',
  },
};

// A method is "live" when its credentials are present; otherwise it runs in mock mode.
export const isConfigured = {
  razorpay: () => Boolean(config.razorpay.keyId && config.razorpay.keySecret),
  cashfree: () => Boolean(config.cashfree.appId && config.cashfree.secretKey),
  upi_direct: () => Boolean(config.upi.vpa),
  cod: () => true,
  mock: () => true,
  shiprocket: () => Boolean(config.shipping.email && config.shipping.password),
};
