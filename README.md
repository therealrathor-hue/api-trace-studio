# API Trace Studio ⚡

[![npm version](https://img.shields.io/badge/npm-v1.0.0-blue.svg)](https://www.npmjs.com/package/api-trace-studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-Compatible-orange.svg)](https://opentelemetry.io/)

> **Zero-friction, production-ready API logging, function tracing, error monitoring, and observability dashboard for Node.js applications.**

Stop cluttering your controllers, services, and route handlers with manual `console.log()` statements. **`api-trace-studio`** is a drop-in npm package that automatically records structured HTTP logs, traces internal function execution and downstream HTTP/DB calls, catches exceptions with deduplication, and serves an integrated, real-time observability dashboard—all with minimal configuration and zero external telemetry infrastructure required.

---

## 🌟 Key Highlights

- 🚀 **Zero Boilerplate:** One middleware call automatically logs method, route, status code, high-resolution latency, client IP, query, headers, and payload.
- 📊 **Built-in Web Dashboard:** Responsive, self-contained dashboard mounted at `/logs` (or custom endpoint) featuring Gantt waterfall timelines, live Server-Sent Events (SSE) streaming, status distributions, latency percentiles (P50, P90, P95, P99), and log search.
- 🔍 **Distributed & Function Tracing:** W3C TraceContext (`traceparent`) compatible with OpenTelemetry support. Easily trace services, controllers, and async methods using `traceClass`, `traceAsync`, `traceFunction`, or TypeScript `@Trace` decorators.
- 🌐 **Outbound & Database Instrumentation:** Automatically intercepts outbound `http.request`, `https.request`, and `fetch` calls, recording child spans and propagating trace context downstream. Includes a Mongoose / MongoDB query tracking plugin.
- 🛡️ **Enterprise Security & Redaction:** Deep recursive redaction masks passwords, API keys, bearer tokens, cookies, JWTs, credit card numbers, and SSNs. Dashboard access can be protected with timing-safe Basic Auth or Bearer tokens.
- ⚡ **Low Overhead & Safe Execution:** Microsecond accuracy via `process.hrtime.bigint()`, bounded in-memory circular ring buffers, and asynchronous batched file writers. Logger failures are safely isolated and will **never** crash your host application.
- 🛠️ **Full CLI Suite:** Includes `init`, `validate`, `doctor`, `dashboard`, and `clean` commands.
- 🔌 **Framework Agnostic:** First-class support for **Express**, **Fastify**, **NestJS**, and vanilla Node.js HTTP.

---

## 🏗️ Architecture

```
                                  INCOMING REQUEST
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │     apiTraceMiddleware (Express)      │
                     │   or apiTraceFastifyPlugin (Fastify)  │
                     └──────────────────┬────────────────────┘
                                         │
                         [AsyncLocalStorage Context]
                   ┌─────────────────────┴─────────────────────┐
                   │  • traceId (W3C TraceContext)             │
                   │  • requestId (UUID / X-Request-Id)        │
                   │  • Child spans & breadcrumbs              │
                   └─────────────────────┬─────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
┌──────────────┐                 ┌──────────────┐                 ┌──────────────┐
│  Controller  │                 │   Service    │                 │  Outbound    │
│  or Route    │                 │ (traceClass/ │                 │ HTTP / DB    │
│              │                 │  traceAsync) │                 │ (Auto-span)  │
└───────┬──────┘                 └───────┬──────┘                 └───────┬──────┘
        │                                │                                │
        └────────────────────────────────┼────────────────────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │            Redaction Engine           │
                     │  (Masks secrets, JWTs, cards, tokens) │
                     └──────────────────┬────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
      ┌─────────────────────────┐                 ┌─────────────────────────┐
      │  In-Memory Ring Buffer  │                 │  Asynchronous Rotator   │
      │  (Instant queries & SSE)│                 │  (JSONL log files)      │
      └────────────┬────────────┘                 └─────────────────────────┘
                   │
                   ▼
      ┌─────────────────────────┐
      │ Built-in Web Dashboard  │
      │ (/logs or standalone)   │
      └─────────────────────────┘
```

---

## 📦 Installation

```bash
npm install api-trace-studio
```

*Optional peer dependencies:* `@opentelemetry/api` is supported out-of-the-box if you use OpenTelemetry in your stack.

---

## 🚀 Quick Start

### 1. Initialize Configuration (Recommended)

Generate an `api-trace.config.js` configuration file in your project root:

```bash
npx api-trace-studio init
```

### 2. Express Integration

Add `api-trace-studio` at the very top of your main application file:

```javascript
const express = require('express');
const {
  initApiTrace,
  apiTraceMiddleware,
  apiTraceErrorMiddleware,
  dashboardMiddleware,
} = require('api-trace-studio');

// 1. Initialize tracer and logger (call once before routes)
initApiTrace({
  serviceName: 'my-express-api',
  environment: process.env.NODE_ENV || 'development',
});

const app = express();
app.use(express.json());

// 2. Attach tracing middleware (first middleware in chain)
app.use(apiTraceMiddleware());

// 3. Mount Observability Dashboard at /logs
app.use('/logs', dashboardMiddleware());

// Standard routes - no manual logging needed!
app.get('/api/users', (req, res) => {
  res.json([{ id: 1, name: 'Alice' }]);
});

app.post('/api/users', (req, res) => {
  // Passwords, tokens, and credit cards are automatically redacted in logs!
  res.status(201).json({ success: true });
});

// 4. Attach error middleware (before your final error handler)
app.use(apiTraceErrorMiddleware());

app.listen(3000, () => {
  console.log('App running on http://localhost:3000');
  console.log('Observability Dashboard: http://localhost:3000/logs');
});
```

Open **`http://localhost:3000/logs`** in your browser to inspect live traces!

---

### 3. Fastify Integration

`api-trace-studio` integrates seamlessly with Fastify via its plugin architecture:

```javascript
const Fastify = require('fastify');
const { initApiTrace, apiTraceFastifyPlugin } = require('api-trace-studio');

initApiTrace({ serviceName: 'my-fastify-api' });

const app = Fastify();

async function bootstrap() {
  // Register api-trace-studio plugin
  await app.register(apiTraceFastifyPlugin);

  app.get('/api/products', async (request, reply) => {
    return [{ id: 'p1', name: 'Laptop' }];
  });

  await app.listen({ port: 3000 });
}

bootstrap();
```

---

### 4. NestJS Integration

NestJS applications running on Express or Fastify can use the middleware and interceptor helpers:

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  initApiTrace,
  apiTraceMiddleware,
  dashboardMiddleware,
  ApiTraceExceptionFilter,
} from 'api-trace-studio';

async function bootstrap() {
  initApiTrace({ serviceName: 'my-nestjs-api' });

  const app = await NestFactory.create(AppModule);

  // Attach middleware
  app.use(apiTraceMiddleware());
  app.use('/logs', dashboardMiddleware());

  // Attach global exception filter for deduplicated error tracking
  app.useGlobalFilters(new ApiTraceExceptionFilter());

  await app.listen(3000);
}
bootstrap();
```

---

## 📊 Web Dashboard Tour

The integrated dashboard is self-contained with **zero external CDN dependencies** (works in air-gapped VPCs and offline environments).

### Features:
1. **Overview Tab:**
   - Real-time KPI summary cards: Total Requests, Requests/min, Error Rate %, Average Latency, P50, P95, and P99.
   - HTTP Status Code distribution chart (2xx, 3xx, 4xx, 5xx).
   - Top 5 slowest endpoints and top 5 unhandled exceptions.
2. **Request Explorer:**
   - Real-time interactive table with Method and Status badges.
   - Latency color coding: Green (<300ms), Yellow (300ms–1000ms), Red (>1000ms).
   - Comprehensive filtering: Full-text search, HTTP method, status code range (`2xx`, `4xx`, `5xx`), log level, slow-only, and error-only toggles.
   - Full server-side pagination.
3. **Trace Inspector Drawer (Click any request):**
   - **Waterfall / Gantt Timeline:** Visualizes child spans (Controllers, Services, DB Queries, Outbound HTTP calls) with relative start offsets and execution durations.
   - **Overview Details:** Timestamp, client IP, user agent, route, trace ID, request ID.
   - **Headers:** Complete request headers with sensitive headers masked.
   - **Payload & Query:** Formatted JSON payload with recursive redaction.
   - **Error & Call Stack:** Formatted exception name, message, and clickable stack trace.
4. **Slow APIs Tab:**
   - Dedicated table highlighting slowest endpoints, minimum/average/maximum duration, call counts, and impact score.
5. **Errors & Exceptions Tab:**
   - Grouped by fingerprint (`ErrorType:Message:StackFrame`), occurrences count, first seen, and last seen timestamps.
6. **Live Terminal Stream:**
   - Real-time log streaming using Server-Sent Events (SSE) with auto-scroll and pause/resume controls.
7. **Export:**
   - Instant 1-click download of filtered logs in **JSON** or **CSV** formats.
8. **Dark / Light Theme:**
   - High-contrast Dark Mode (default) with persistent local storage theme toggle.

---

## 🔍 Function & Service Tracing

For deep observability beyond HTTP requests, `api-trace-studio` provides non-invasive wrappers to record child spans in your request timeline.

### Automatic Class Tracing (`traceClass`)

Automatically trace all methods of a service or controller class without modifying their implementation:

```javascript
const { traceClass } = require('api-trace-studio');

class PaymentService {
  async chargeCard(userId, amount) {
    // business logic...
    return { success: true };
  }

  calculateTax(amount, state) {
    return amount * 0.08;
  }
}

// Automatically wraps all methods: creates spans 'PaymentService.chargeCard', etc.
const TracedPaymentService = traceClass(PaymentService);

const paymentService = new TracedPaymentService();
```

### Async Function Tracing (`traceAsync`)

Wrap promise-returning functions or individual async operations:

```javascript
const { traceAsync } = require('api-trace-studio');

const fetchUserProfile = traceAsync('fetchUserProfile', async (userId) => {
  const user = await db.users.findById(userId);
  return user;
});
```

### Synchronous Function Tracing (`traceFunction`)

```javascript
const { traceFunction } = require('api-trace-studio');

const computeHash = traceFunction('computeHash', (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
});
```

### TypeScript Method Decorator (`@Trace`)

```typescript
import { Trace } from 'api-trace-studio';

class OrderController {
  @Trace('OrderController.processOrder')
  async processOrder(orderId: string) {
    // Automatically traced as a child span
  }
}
```

### Manual Spans & Breadcrumbs

```javascript
const { apiTrace, logger } = require('api-trace-studio');

app.post('/api/checkout', async (req, res) => {
  // Attach metadata tags to current trace
  apiTrace.setTag('tenantId', req.headers['x-tenant-id']);
  apiTrace.setTag('cartTotal', req.body.total);

  // Add breadcrumbs for error investigation
  apiTrace.addBreadcrumb('Inventory reserved', 'order', { items: 3 });

  // Manual span
  const span = apiTrace.startSpan('CustomAlgorithm');
  try {
    // complex work...
  } finally {
    span.end();
  }

  logger.info('Checkout completed successfully');
  res.json({ ok: true });
});
```

---

## 🌐 Outbound HTTP & Database Monitoring

### Outbound HTTP & Fetch Interception

When `outbound.http` and `outbound.fetch` are enabled (the default), `api-trace-studio` automatically instruments Node's native `http`, `https`, and `globalThis.fetch`:

1. Measures outbound call duration and HTTP response status code.
2. Creates a child span e.g. `HTTP GET api.stripe.com`.
3. Injects W3C `traceparent` and `X-Request-Id` headers into outgoing requests to enable end-to-end distributed tracing across microservices.

### MongoDB / Mongoose Plugin

Instrument Mongoose queries with execution duration, collection name, and operation type:

```javascript
const mongoose = require('mongoose');
const { apiTraceMongoosePlugin } = require('api-trace-studio');

// Apply globally to all schemas
mongoose.plugin(apiTraceMongoosePlugin);
```

Queries like `User.find()`, `Order.updateOne()`, and `Product.aggregate()` will now appear as visual spans on the dashboard waterfall timeline!

---

## 🛡️ Security & Redaction

### Automatic Field Redaction

By default, any key matching sensitive terms (case-insensitive substring match) is replaced with `[REDACTED]`:

- `password`, `pass`, `pwd`
- `secret`, `secretKey`, `clientSecret`
- `token`, `accessToken`, `refreshToken`, `apiKey`
- `authorization`, `cookie`, `set-cookie`, `proxy-authorization`
- `creditCard`, `cardNumber`, `cvv`, `cvc`, `ssn`
- `privateKey`

### Pattern Masking in Strings

Even if secrets appear inside arbitrary string values, `api-trace-studio` automatically masks:
- **Bearer Tokens:** `Bearer ey...` ➔ `Bearer [REDACTED]`
- **JWTs:** `eyJ...` ➔ `[REDACTED_JWT]`
- **Credit Cards:** `4111-2222-3333-4444` ➔ `[REDACTED_CARD]`
- **Social Security Numbers:** `000-12-3456` ➔ `[REDACTED_SSN]`

### Dashboard Protection

To protect dashboard access in production, enable authentication in `api-trace.config.js`:

```javascript
dashboard: {
  auth: {
    enabled: process.env.NODE_ENV === 'production',
    username: process.env.API_TRACE_DASHBOARD_USER || 'admin',
    password: process.env.API_TRACE_DASHBOARD_PASS || 'your-secure-password',
    token: process.env.API_TRACE_DASHBOARD_TOKEN, // Optional bearer token
  }
}
```

Credentials are verified using **`crypto.timingSafeEqual`** to prevent side-channel timing attacks. All dashboard endpoints sanitize paths to prevent directory traversal and encode text to prevent XSS.

---

## ⚙️ Configuration Reference

Configuration can be specified programmatically in `initApiTrace(options)`, loaded from `api-trace.config.js`, or overridden via environment variables.

| Property | Environment Variable | Default | Description |
| :--- | :--- | :--- | :--- |
| `serviceName` | `API_TRACE_SERVICE_NAME` | `package.name` | Name of your service |
| `environment` | `API_TRACE_ENV` / `NODE_ENV` | `'development'` | Environment name |
| `logLevel` | `API_TRACE_LOG_LEVEL` | `'info'` | `'trace'` \| `'debug'` \| `'info'` \| `'warn'` \| `'error'` \| `'fatal'` |
| `storage.type` | `API_TRACE_STORAGE_TYPE` | `'both'` | `'file'` \| `'memory'` \| `'both'` |
| `storage.directory` | `API_TRACE_STORAGE_DIR` | `'./logs'` | Path to log directory |
| `storage.filename` | - | `'api-trace.log'` | Primary log filename |
| `storage.maxSizeBytes` | `API_TRACE_STORAGE_MAX_SIZE_MB` | `10485760` (10MB) | Max size before file rotation |
| `storage.maxFiles` | `API_TRACE_STORAGE_MAX_FILES` | `14` | Number of rotated log files to retain |
| `storage.inMemoryBufferSize`| - | `2000` | Circular buffer capacity for instant dashboard queries |
| `dashboard.enabled` | `API_TRACE_DASHBOARD_ENABLED` | `true` | Enable or disable built-in dashboard |
| `dashboard.endpoint` | `API_TRACE_DASHBOARD_ENDPOINT`| `'/logs'` | HTTP mount route for the dashboard |
| `dashboard.auth.enabled` | `API_TRACE_DASHBOARD_AUTH_ENABLED` | `false` | Protect dashboard with authentication |
| `dashboard.auth.username` | `API_TRACE_DASHBOARD_USER` | `'admin'` | Basic Auth username |
| `dashboard.auth.password` | `API_TRACE_DASHBOARD_PASS` | `''` | Basic Auth password |
| `performance.slowApiThresholdMs` | `API_TRACE_SLOW_API_THRESHOLD_MS` | `1000` | Latency threshold to flag APIs as slow |
| `performance.slowFunctionThresholdMs` | `API_TRACE_SLOW_FN_THRESHOLD_MS` | `200` | Latency threshold to flag functions as slow |
| `performance.slowDbThresholdMs` | `API_TRACE_SLOW_DB_THRESHOLD_MS` | `500` | Latency threshold to flag database queries |
| `sampling.rate` | `API_TRACE_SAMPLING_RATE` | `1.0` | Sampling rate (`1.0` = 100%, `0.1` = 10%) |
| `sampling.alwaysSampleErrors` | - | `true` | Always log requests with errors regardless of sampling |
| `outbound.http` | - | `true` | Automatically instrument outbound HTTP/HTTPS calls |
| `outbound.fetch` | - | `true` | Automatically instrument global `fetch` |
| `ignoreRoutes` | - | `['/health', '/metrics', ...]` | Array of route prefixes to skip entirely |

---

## 💻 CLI Commands

`api-trace-studio` includes a built-in CLI executable:

### 1. Generate Configuration

```bash
npx api-trace-studio init [--force]
```
Generates a pre-configured `api-trace.config.js` file with production best practices.

### 2. Validate Configuration & Storage

```bash
npx api-trace-studio validate [--config ./custom.config.js]
```
Verifies configuration syntax, tests log directory write permissions, tests sensitive data redaction rules, and alerts if dashboard authentication is disabled in production.

### 3. Diagnostics & Health Doctor

```bash
npx api-trace-studio doctor
```
Outputs runtime diagnostics including Node version, memory usage, CPU cores, active configuration, log file counts, and disk space consumed.

### 4. Standalone Dashboard

```bash
npx api-trace-studio dashboard --port 4000 --logs ./logs
```
Runs the observability dashboard as an independent HTTP server. Perfect for viewing logs in production without mounting routes inside your primary app.

### 5. Prune & Clean Old Logs

```bash
npx api-trace-studio clean --older-than 7
```
Deletes rotated log files older than the specified retention window to free disk space.

---

## 💡 Observability Insights & Technical Honesty

In the Node.js ecosystem, transparent observability requires acknowledging technical realities:

1. **Request Context Isolation:** `api-trace-studio` relies on Node.js native `AsyncLocalStorage`. Context flows seamlessly across promises, async/await, and event callbacks. However, if third-party libraries use non-standard event dispatching without preserving async context, wrap the callback using `RequestContextManager.run`.
2. **Function Tracing Scope:** Internal functions cannot be magically observed by runtime middleware without explicit instrumentations. `api-trace-studio` eliminates manual logging by providing lightweight wrappers (`traceClass`, `traceAsync`, `traceFunction`) and automatic hooks for outbound HTTP, `fetch`, and Mongoose. It deliberately avoids dangerous runtime AST file rewriting or monkey-patching arbitrary V8 engine internals.
3. **Log Rotation & Non-blocking I/O:** File writing is fully asynchronous with buffered queueing. File rotation checks avoid locking event loop ticks. If disk space runs out or writes fail, errors are safely absorbed without interrupting HTTP request cycles.

---

## 🚢 Publishing to NPM

To publish this package to the npm registry:

### Prerequisites:
1. Ensure you have an active npm account: `npm login`
2. Verify you have rights to publish the package name.

### Step-by-Step Commands:

```bash
# 1. Verify all tests pass
npm test

# 2. Run clean TypeScript build
npm run build

# 3. Verify packaged tarball contents (dry run)
npm pack --dry-run

# 4. Publish to npm registry (public access)
npm publish --access public
```

---

## 📄 License

MIT © [API Trace Studio Contributors](LICENSE)
