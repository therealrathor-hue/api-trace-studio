import { Request, Response, NextFunction } from 'express';
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
import { recordCapturedError, serializeError } from '../errors';

function isRouteIgnored(url: string, ignoredRoutes: string[], dashboardEndpoint: string): boolean {
  if (dashboardEndpoint && (url === dashboardEndpoint || url.startsWith(dashboardEndpoint + '/'))) {
    return true;
  }

  for (const pattern of ignoredRoutes) {
    if (url === pattern || url.startsWith(pattern + '/') || url.startsWith(pattern + '?')) {
      return true;
    }
  }
  return false;
}

function filterHeaders(headers: Record<string, any>, allowedHeaders: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  const allowedSet = new Set(allowedHeaders.map((h) => h.toLowerCase()));

  for (const [key, val] of Object.entries(headers)) {
    if (allowedSet.has(key.toLowerCase())) {
      result[key] = val;
    }
  }
  return result;
}

export function apiTraceMiddleware(options?: { ignoredRoutes?: string[] }) {
  return function (req: Request, res: Response, next: NextFunction): void {
    const config = getConfig();
    const ignored = options?.ignoredRoutes || config.ignoreRoutes;
    const requestUrl = req.originalUrl || req.url || '/';

    // Fast bypass if route is ignored
    if (isRouteIgnored(requestUrl, ignored, config.dashboard.endpoint)) {
      return next();
    }

    // Parse or generate trace context
    const traceParentHeader = req.headers['traceparent'] as string | undefined;
    const parsedTraceParent = parseTraceParent(traceParentHeader);

    const traceId = parsedTraceParent ? parsedTraceParent.traceId : generateTraceId();
    const parentSpanId = parsedTraceParent ? parsedTraceParent.parentSpanId : undefined;
    const rootSpanId = generateSpanId();
    const requestId = (req.headers['x-request-id'] as string) || generateRequestId();

    // Set response headers for client correlation
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-trace-id', traceId);
    res.setHeader('traceparent', formatTraceParent(traceId, rootSpanId));

    const startHr = process.hrtime.bigint();
    const startTimeIso = new Date().toISOString();

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '';

    const userAgent = (req.headers['user-agent'] as string) || '';

    const capturedHeaders = filterHeaders(req.headers, config.tracing.captureHeaders);

    const context: RequestContextData = {
      traceId,
      requestId,
      spanId: rootSpanId,
      parentSpanId,
      startHrTime: startHr,
      startTimeIso,
      method: req.method,
      url: requestUrl,
      headers: capturedHeaders,
      query: req.query as Record<string, unknown>,
      clientIp,
      spans: [],
      breadcrumbs: [],
      tags: {},
      errorCaptured: false,
    };

    // Hook res.end to capture execution completion
    const originalEnd = res.end;
    let ended = false;

    res.end = function (this: any, ...args: any[]): any {
      if (!ended) {
        ended = true;

        const diffNs = process.hrtime.bigint() - startHr;
        const durationMs = Math.round((Number(diffNs) / 1_000_000) * 100) / 100;
        const statusCode = res.statusCode;
        const isSlow = durationMs >= config.performance.slowApiThresholdMs;

        // Route resolution in Express
        let matchedRoute = '';
        if (req.route && req.route.path) {
          const basePath = req.baseUrl || '';
          matchedRoute = basePath + req.route.path;
        } else {
          matchedRoute = (req.baseUrl || '') + (req.path || requestUrl.split('?')[0]);
        }

        let level: 'info' | 'warn' | 'error' = 'info';
        if (statusCode >= 500) {
          level = 'error';
        } else if (statusCode >= 400) {
          level = 'warn';
        }

        // Capture request body if configured and available
        let body: unknown = undefined;
        if (config.tracing.captureRequestBody && req.body) {
          try {
            const bodyStr = JSON.stringify(req.body);
            if (bodyStr.length <= config.tracing.maxBodySize) {
              body = req.body;
            } else {
              body = { _truncated: true, sizeBytes: bodyStr.length };
            }
          } catch {
            body = '[Unserializable Body]';
          }
        }

        // If status code is an error and no exception was caught, create error object
        let recordError = context.error ? serializeError(context.error) : undefined;
        if (!recordError && statusCode >= 400) {
          recordError = {
            name: 'HttpError',
            message: `HTTP ${statusCode} ${res.statusMessage || ''}`.trim(),
            statusCode,
          };
        }

        const logRecord: LogRecord = {
          id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
          timestamp: startTimeIso,
          level,
          service: config.serviceName,
          env: config.environment,
          type: 'http_request',
          traceId,
          requestId,
          method: req.method,
          url: requestUrl,
          route: matchedRoute,
          statusCode,
          durationMs,
          isSlow,
          clientIp,
          userAgent,
          headers: capturedHeaders,
          query: req.query as Record<string, unknown>,
          body,
          spans: context.spans,
          breadcrumbs: context.breadcrumbs,
          tags: context.tags,
          error: recordError,
        };

        const logger = getLogger();
        logger.logRequest(logRecord);
      }

      return originalEnd.apply(this, args as any);
    };

    // Run inside RequestContext
    RequestContextManager.run(context, () => {
      next();
    });
  };
}

export function apiTraceErrorMiddleware() {
  return function (err: unknown, req: Request, res: Response, next: NextFunction): void {
    recordCapturedError(err);
    next(err);
  };
}
