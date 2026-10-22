import { URL } from 'url';
import { RequestContextManager, formatTraceParent } from '../context/request-context';
import { getTracer } from './tracer';
import { getConfig } from '../config';

// Require the native CJS module objects rather than immutable ESM module namespaces
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeHttp = require('http');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeHttps = require('https');

let isHttpInstrumented = false;
let isFetchInstrumented = false;

const originalHttpRequest = nodeHttp.request;
const originalHttpGet = nodeHttp.get;
const originalHttpsRequest = nodeHttps.request;
const originalHttpsGet = nodeHttps.get;
const originalFetch = globalThis.fetch;

function safeSetProperty(target: any, prop: string, value: any): void {
  try {
    target[prop] = value;
  } catch {
    try {
      Object.defineProperty(target, prop, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      // ignore
    }
  }
}

function normalizeUrl(
  protocol: string,
  urlOrOptions: string | URL | any,
  options?: any
): { method: string; fullUrl: string; host: string } {
  let method = 'GET';
  let host = 'localhost';
  let fullUrl = '';

  if (typeof urlOrOptions === 'string') {
    try {
      const parsed = new URL(urlOrOptions);
      host = parsed.host;
      fullUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      fullUrl = urlOrOptions;
    }
    if (options && options.method) {
      method = options.method.toUpperCase();
    }
  } else if (urlOrOptions instanceof URL) {
    host = urlOrOptions.host;
    fullUrl = `${urlOrOptions.protocol}//${urlOrOptions.host}${urlOrOptions.pathname}`;
    if (options && options.method) {
      method = options.method.toUpperCase();
    }
  } else if (typeof urlOrOptions === 'object') {
    const opts = urlOrOptions;
    method = (opts.method || 'GET').toUpperCase();
    host = String(opts.host || opts.hostname || 'localhost');
    const port = opts.port ? `:${opts.port}` : '';
    const path = opts.path || '/';
    fullUrl = `${protocol}//${host}${port}${path}`;
  }

  return { method, fullUrl, host };
}

export function instrumentOutboundHttp(): void {
  if (isHttpInstrumented) return;
  isHttpInstrumented = true;

  function patchRequest(
    protocol: 'http:' | 'https:',
    originalFn: any
  ): any {
    return function (this: unknown, ...args: any[]) {
      const config = getConfig();
      if (!config.outbound.enabled || !config.outbound.http) {
        return originalFn.apply(this, args as any);
      }

      const urlOrOptions = args[0];
      const secondArg = args[1];
      const options = typeof secondArg === 'object' && secondArg !== null ? secondArg : (typeof urlOrOptions === 'object' && !(urlOrOptions instanceof URL) ? urlOrOptions : {});

      const { method, fullUrl, host } = normalizeUrl(protocol, urlOrOptions, options);

      const ctx = RequestContextManager.get();
      if (!ctx) {
        // Not in an active tracked request context, run normally
        return originalFn.apply(this, args as any);
      }

      const tracer = getTracer();
      const spanName = `HTTP ${method} ${host}`;
      const span = tracer.startSpan(spanName, {
        kind: 'client',
        attributes: {
          'http.method': method,
          'http.url': fullUrl,
          'http.host': host,
        },
      });

      // Inject trace context headers if enabled
      if (config.outbound.propagateTraceContext) {
        const traceParentHeader = formatTraceParent(span.traceId, span.id);
        const reqId = ctx.requestId;

        // Try injecting into options or headers
        if (typeof urlOrOptions === 'object' && !(urlOrOptions instanceof URL)) {
          urlOrOptions.headers = urlOrOptions.headers || {};
          (urlOrOptions.headers as any)['traceparent'] = traceParentHeader;
          (urlOrOptions.headers as any)['x-request-id'] = reqId;
        } else if (secondArg && typeof secondArg === 'object') {
          secondArg.headers = secondArg.headers || {};
          (secondArg.headers as any)['traceparent'] = traceParentHeader;
          (secondArg.headers as any)['x-request-id'] = reqId;
        }
      }

      try {
        const clientReq = originalFn.apply(this, args as any);

        clientReq.on('response', (res: any) => {
          span.setAttribute('http.status_code', res.statusCode);
          if (res.statusCode && res.statusCode >= 400) {
            span.setStatus('error');
          }
          span.end();
        });

        clientReq.on('error', (err: Error) => {
          span.recordException(err);
          span.end();
        });

        return clientReq;
      } catch (err) {
        span.recordException(err);
        span.end();
        throw err;
      }
    };
  }

  safeSetProperty(nodeHttp, 'request', patchRequest('http:', originalHttpRequest));
  safeSetProperty(nodeHttp, 'get', function (this: unknown, ...args: any[]) {
    const req = nodeHttp.request.apply(this, args);
    req.end();
    return req;
  });

  safeSetProperty(nodeHttps, 'request', patchRequest('https:', originalHttpsRequest));
  safeSetProperty(nodeHttps, 'get', function (this: unknown, ...args: any[]) {
    const req = nodeHttps.request.apply(this, args);
    req.end();
    return req;
  });

  // Instrument global fetch if available
  if (typeof globalThis.fetch === 'function') {
    isFetchInstrumented = true;
    globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const config = getConfig();
      if (!config.outbound.enabled || !config.outbound.fetch) {
        return originalFetch(input, init);
      }

      const ctx = RequestContextManager.get();
      if (!ctx) {
        return originalFetch(input, init);
      }

      const method = (init?.method || 'GET').toUpperCase();
      let urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      let host = 'unknown';
      try {
        host = new URL(urlStr).host;
      } catch {
        // ignore
      }

      const tracer = getTracer();
      const span = tracer.startSpan(`FETCH ${method} ${host}`, {
        kind: 'client',
        attributes: {
          'http.method': method,
          'http.url': urlStr,
          'http.host': host,
        },
      });

      const updatedInit = { ...init };
      if (config.outbound.propagateTraceContext) {
        const headers = new Headers(updatedInit.headers || {});
        headers.set('traceparent', formatTraceParent(span.traceId, span.id));
        headers.set('x-request-id', ctx.requestId);
        updatedInit.headers = headers;
      }

      try {
        const response = await originalFetch(input, updatedInit);
        span.setAttribute('http.status_code', response.status);
        if (!response.ok) {
          span.setStatus('error');
        }
        return response;
      } catch (err) {
        span.recordException(err);
        throw err;
      } finally {
        span.end();
      }
    };
  }
}

export function restoreOutboundHttp(): void {
  if (isHttpInstrumented) {
    safeSetProperty(nodeHttp, 'request', originalHttpRequest);
    safeSetProperty(nodeHttp, 'get', originalHttpGet);
    safeSetProperty(nodeHttps, 'request', originalHttpsRequest);
    safeSetProperty(nodeHttps, 'get', originalHttpsGet);
    isHttpInstrumented = false;
  }
  if (isFetchInstrumented && originalFetch) {
    globalThis.fetch = originalFetch;
    isFetchInstrumented = false;
  }
}
