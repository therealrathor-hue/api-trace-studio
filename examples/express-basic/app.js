/**
 * API Trace Studio - Minimal Express Example
 *
 * Run:
 *   node examples/express-basic/app.js
 * Open:
 *   http://localhost:3000/logs
 */

const express = require('express');
const {
  initApiTrace,
  apiTraceMiddleware,
  dashboardMiddleware,
} = require('../../dist');

// 1. Initialize API Trace Studio (once at startup)
initApiTrace({
  serviceName: 'basic-express-service',
  environment: 'development',
});

const app = express();
app.use(express.json());

// 2. Attach tracing middleware (first middleware)
app.use(apiTraceMiddleware());

// 3. Mount Web Dashboard at /logs
app.use('/logs', dashboardMiddleware());

// Routes
app.get('/', (req, res) => {
  res.send('<h1>API Trace Studio Minimal Demo</h1><p><a href="/logs">Open Observability Dashboard</a></p>');
});

app.get('/api/users', (req, res) => {
  res.json([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ]);
});

app.post('/api/login', (req, res) => {
  // Passwords and tokens in body are automatically redacted in logs!
  res.json({ success: true, token: 'jwt_sample_token_secret' });
});

app.get('/api/slow', async (req, res) => {
  // Simulates a slow API
  await new Promise((r) => setTimeout(r, 1200));
  res.json({ message: 'This took > 1s and was flagged as slow in dashboard!' });
});

app.get('/api/error', (req, res) => {
  throw new Error('Simulated internal server failure!');
});

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
  console.log(`Basic Express App listening on http://localhost:${PORT}`);
  console.log(`Observability Dashboard at: http://localhost:${PORT}/logs`);
});
