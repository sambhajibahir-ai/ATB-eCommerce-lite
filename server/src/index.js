import { app } from './app.js';
import { config, isConfigured } from './config.js';
import { startInventoryScheduler } from './services/inventorySync.js';

app.listen(config.port, () => {
  console.log(`API on http://localhost:${config.port}`);
  const mode = (k) => (isConfigured[k]() ? 'LIVE' : 'mock');
  console.log(
    `  razorpay: ${mode('razorpay')} | cashfree: ${mode('cashfree')} (${config.cashfree.env}) | upi_direct: ${mode('upi_direct')} | shiprocket: ${mode('shiprocket')}`
  );
  startInventoryScheduler();
});
