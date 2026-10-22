import * as fs from 'fs';
import * as path from 'path';

export const CONFIG_TEMPLATE = `/**
 * API Trace Studio Configuration
 * https://github.com/api-trace-studio
 */
module.exports = {
  serviceName: process.env.API_TRACE_SERVICE_NAME || 'my-api-service',
  environment: process.env.NODE_ENV || 'development',
  logLevel: 'info', // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

  storage: {
    type: 'both', // 'file' | 'memory' | 'both'
    directory: './logs',
    filename: 'api-trace.log',
    maxSizeBytes: 10 * 1024 * 1024, // 10MB per file
    maxFiles: 14, // Keep 14 rotated files
    inMemoryBufferSize: 2000, // Ring buffer for dashboard queries
    flushIntervalMs: 500,
  },

  dashboard: {
    enabled: true,
    endpoint: '/logs',
    title: 'API Trace Studio',
    auth: {
      enabled: process.env.NODE_ENV === 'production',
      username: process.env.API_TRACE_DASHBOARD_USER || 'admin',
      password: process.env.API_TRACE_DASHBOARD_PASS || 'change-me-in-production',
    },
    pollingIntervalMs: 3000,
    sseEnabled: true,
  },

  performance: {
    slowApiThresholdMs: 1000,      // APIs >= 1000ms flagged as slow
    slowFunctionThresholdMs: 200,  // Functions >= 200ms flagged
    slowDbThresholdMs: 500,        // DB queries >= 500ms flagged
    slowOutboundThresholdMs: 800,  // Outbound HTTP >= 800ms flagged
  },

  redaction: {
    enabled: true,
    keys: [
      'password',
      'secret',
      'token',
      'authorization',
      'cookie',
      'apiKey',
      'creditCard',
      'cvv',
      'ssn',
      'privateKey',
    ],
    maskHeaders: ['authorization', 'cookie', 'set-cookie', 'x-api-key'],
    replacement: '[REDACTED]',
    maskPatterns: true,
  },

  tracing: {
    enabled: true,
    captureHeaders: ['content-type', 'user-agent', 'x-forwarded-for', 'x-request-id'],
    captureRequestBody: true,
    captureResponseBody: false,
    maxBodySize: 65536, // 64KB
  },

  outbound: {
    enabled: true,
    http: true,
    fetch: true,
    propagateTraceContext: true,
  },

  ignoreRoutes: [
    '/health',
    '/healthz',
    '/favicon.ico',
    '/metrics',
  ],
};
`;

export function runInit(options: { force?: boolean } = {}): void {
  const targetPath = path.resolve(process.cwd(), 'api-trace.config.js');

  if (fs.existsSync(targetPath) && !options.force) {
    console.error('[api-trace-studio] Error: api-trace.config.js already exists in current directory.');
    console.error('Use --force to overwrite.');
    process.exit(1);
  }

  fs.writeFileSync(targetPath, CONFIG_TEMPLATE, 'utf-8');
  console.log('✔ Successfully generated api-trace.config.js\n');

  console.log('🚀 Quick Integration:');
  console.log('---------------------');
  console.log('// In your Express application:');
  console.log("const { initApiTrace, apiTraceMiddleware, dashboardMiddleware } = require('api-trace-studio');\n");
  console.log('initApiTrace(); // Initializes tracer & logger');
  console.log('app.use(apiTraceMiddleware()); // Must be first middleware');
  console.log("app.use('/logs', dashboardMiddleware()); // Observability UI\n");
  console.log('Run your app and open: http://localhost:PORT/logs\n');
}
