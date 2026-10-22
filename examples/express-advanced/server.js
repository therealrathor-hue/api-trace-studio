/**
 * API Trace Studio - Advanced Express Example
 * Demonstrates:
 *   - Service & Controller class tracing (traceClass)
 *   - Async function wrapping (traceAsync)
 *   - Outbound HTTP tracing with distributed traceparent propagation
 *   - Custom tags and breadcrumbs
 *   - Dashboard Basic Authentication
 */

const express = require('express');
const http = require('http');
const {
  initApiTrace,
  apiTraceMiddleware,
  apiTraceErrorMiddleware,
  dashboardMiddleware,
  traceClass,
  traceAsync,
  apiTrace,
  logger,
} = require('../../dist');

// 1. Initialize API Trace Studio with advanced settings
initApiTrace({
  serviceName: 'order-processing-service',
  environment: 'production',
  performance: {
    slowApiThresholdMs: 800,
    slowFunctionThresholdMs: 150,
  },
  dashboard: {
    enabled: true,
    endpoint: '/admin/traces',
    title: 'Order Service APM',
    auth: {
      enabled: true,
      username: 'admin',
      password: 'password123',
    },
  },
  outbound: {
    enabled: true,
    http: true,
    propagateTraceContext: true,
  },
});

// Mock External Inventory Service (Downstream)
const inventoryServer = http.createServer((req, res) => {
  console.log('[Inventory Mock] Received downstream request with headers:', {
    traceparent: req.headers['traceparent'],
    'x-request-id': req.headers['x-request-id'],
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ inStock: true, quantity: 42 }));
});
inventoryServer.listen(9001, '127.0.0.1');

// Business Logic Service
class PaymentService {
  async processPayment(orderId, amount, creditCard) {
    // Simulated processing time
    await new Promise((r) => setTimeout(r, 60));
    return { transactionId: 'tx_' + Math.random().toString(36).substring(7), status: 'COMPLETED' };
  }

  async verifyFraudCheck(userId) {
    await new Promise((r) => setTimeout(r, 20));
    return { riskScore: 0.05, approved: true };
  }
}

// Automatically wrap all methods of PaymentService for tracing
const TracedPaymentService = traceClass(PaymentService);
const paymentService = new TracedPaymentService();

// Standalone traced async function
const fetchInventoryCheck = traceAsync('InventoryService.checkStock', async (productId) => {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9001/inventory/' + productId, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
});

const app = express();
app.use(express.json());

// Main tracing middleware
app.use(apiTraceMiddleware());

// Mount Dashboard with Basic Auth (admin / password123)
app.use('/admin/traces', dashboardMiddleware());

// Order creation endpoint
app.post('/api/orders', async (req, res, next) => {
  try {
    const { userId, productId, amount, creditCard } = req.body;

    // Attach custom business tags and breadcrumb to current trace
    apiTrace.setTag('userId', userId);
    apiTrace.setTag('productId', productId);
    apiTrace.addBreadcrumb('Starting order checkout process', 'order');

    // 1. Check stock via outbound HTTP (automatically traced & correlated)
    const stock = await fetchInventoryCheck(productId);
    apiTrace.addBreadcrumb('Stock verification complete', 'order', stock);

    // 2. Fraud check & payment (automatically traced methods)
    await paymentService.verifyFraudCheck(userId);
    const payment = await paymentService.processPayment('ord_101', amount, creditCard);

    logger.info('Order completed successfully', { orderId: 'ord_101', amount });

    res.status(201).json({
      orderId: 'ord_101',
      status: 'confirmed',
      stock,
      payment,
    });
  } catch (err) {
    next(err);
  }
});

// Error middleware
app.use(apiTraceErrorMiddleware());
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Advanced Express App running at: http://localhost:${PORT}`);
  console.log(`Observability Dashboard at: http://localhost:${PORT}/admin/traces`);
  console.log(`Credentials: user=admin, pass=password123`);
});
