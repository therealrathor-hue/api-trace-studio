import * as crypto from 'crypto';
import { getConfig } from '../config';
import { getLogger } from '../logger';
import {
  RequestContextData,
  RequestContextManager,
  formatTraceParent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  parseTraceParent,
} from '../context/request-context';
import { LogRecord } from '../storage/types';
import { serializeError } from '../errors';

export function apiTraceFastifyPlugin(fastify: any, options: any, done: (err?: Error) => void): void {
  const config = getConfig();

  fastify.addHook('onRequest', (request: any, reply: any, next: () => void) => {
    const rawUrl = request.raw?.url || request.url || '/';

    // Fast bypass if route is ignored or matches dashboard
    if (config.dashboard.endpoint && (rawUrl === config.dashboard.endpoint || rawUrl.startsWith(config.dashboard.endpoint + '/'))) {
      return next();
    }
    for (const pattern of config.ignoreRoutes) {
      if (rawUrl === pattern || rawUrl.startsWith(pattern + '/') || rawUrl.startsWith(pattern + '?')) {
        return next();
      }
    }

    const traceParentHeader = request.headers['traceparent'];
    const parsedTraceParent = parseTraceParent(traceParentHeader);
    const traceId = parsedTraceParent ? parsedTraceParent.traceId : generateTraceId();
    const parentSpanId = parsedTraceParent ? parsedTraceParent.parentSpanId : undefined;
    const rootSpanId = generateSpanId();
    const requestId = (request.headers['x-request-id'] as string) || generateRequestId();

    reply.header('x-request-id', requestId);
    reply.header('x-trace-id', traceId);
    reply.header('traceparent', formatTraceParent(traceId, rootSpanId));

    const startHr = process.hrtime.bigint();
    const startTimeIso = new Date().toISOString();

    const clientIp = request.ip || request.headers['x-forwarded-for'] || '';
    const userAgent = request.headers['user-agent'] || '';

    const context: RequestContextData = {
      traceId,
      requestId,
      spanId: rootSpanId,
      parentSpanId,
      startHrTime: startHr,
      startTimeIso,
      method: request.method,
      url: rawUrl,
      headers: request.headers,
      query: request.query,
      clientIp,
      spans: [],
      breadcrumbs: [],
      tags: {},
      errorCaptured: false,
    };

    request._apiTraceContext = context;

    RequestContextManager.run(context, () => {
      next();
    });
  });

  fastify.addHook('onError', (request: any, reply: any, error: any, next: () => void) => {
    const context: RequestContextData = request._apiTraceContext;
    if (context) {
      context.error = error;
      context.errorCaptured = true;
    }
    next();
  });

  fastify.addHook('onResponse', (request: any, reply: any, next: () => void) => {
    const context: RequestContextData = request._apiTraceContext;
    if (!context) {
      return next();
    }

    const diffNs = process.hrtime.bigint() - context.startHrTime;
    const durationMs = Math.round((Number(diffNs) / 1_000_000) * 100) / 100;
    const statusCode = reply.statusCode;
    const isSlow = durationMs >= config.performance.slowApiThresholdMs;
    const matchedRoute = request.routeOptions?.url || request.routerPath || request.url;

    let level: 'info' | 'warn' | 'error' = 'info';
    if (statusCode >= 500) {
      level = 'error';
    } else if (statusCode >= 400) {
      level = 'warn';
    }

    let recordError = context.error ? serializeError(context.error) : undefined;
    if (!recordError && statusCode >= 400) {
      recordError = {
        name: 'HttpError',
        message: `HTTP ${statusCode}`,
        statusCode,
      };
    }

    const logRecord: LogRecord = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      timestamp: context.startTimeIso,
      level,
      service: config.serviceName,
      env: config.environment,
      type: 'http_request',
      traceId: context.traceId,
      requestId: context.requestId,
      method: request.method,
      url: context.url,
      route: matchedRoute,
      statusCode,
      durationMs,
      isSlow,
      clientIp: context.clientIp,
      userAgent: (request.headers['user-agent'] as string) || '',
      headers: request.headers,
      query: request.query,
      body: config.tracing.captureRequestBody ? request.body : undefined,
      spans: context.spans,
      breadcrumbs: context.breadcrumbs,
      tags: context.tags,
      error: recordError,
    };

    getLogger().logRequest(logRecord);
    next();
  });

  done();
}

// Support Fastify global hook registration without requiring external fastify-plugin
(apiTraceFastifyPlugin as any)[Symbol.for('skip-override')] = true;
