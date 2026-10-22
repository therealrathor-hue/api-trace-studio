import { Span } from './span';
import { RequestContextManager } from '../context/request-context';
import { TraceSpan } from '../context/types';

let otelApi: typeof import('@opentelemetry/api') | null = null;
try {
  otelApi = require('@opentelemetry/api');
} catch {
  // OTel optional
}

export class Tracer {
  private serviceName: string;

  constructor(serviceName: string = 'node-service') {
    this.serviceName = serviceName;
  }

  public startSpan(
    name: string,
    options: {
      kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
      attributes?: Record<string, unknown>;
    } = {}
  ): Span {
    const span = new Span(name, options);

    // Also bridge to OpenTelemetry if active
    if (otelApi && otelApi.trace) {
      try {
        const activeTracer = otelApi.trace.getTracer(this.serviceName);
        const otelSpan = activeTracer.startSpan(name, {
          attributes: options.attributes as any,
        });
        // We can hook otelSpan end when our span ends
        const originalEnd = span.end.bind(span);
        span.end = () => {
          const res = originalEnd();
          try {
            if (res.status === 'error' && res.error) {
              otelSpan.recordException(new Error(res.error.message));
            }
            otelSpan.end();
          } catch {
            // ignore otel error
          }
          return res;
        };
      } catch {
        // ignore
      }
    }

    return span;
  }

  public async traceAsync<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes?: Record<string, unknown>
  ): Promise<T> {
    const span = this.startSpan(name, { attributes });
    const ctx = RequestContextManager.get();
    const prevActiveSpanId = ctx?.activeSpanId;
    if (ctx) {
      ctx.activeSpanId = span.id;
    }

    try {
      const result = await fn(span);
      return result;
    } catch (err) {
      span.recordException(err);
      throw err;
    } finally {
      if (ctx) {
        ctx.activeSpanId = prevActiveSpanId;
      }
      span.end();
    }
  }

  public traceSync<T>(
    name: string,
    fn: (span: Span) => T,
    attributes?: Record<string, unknown>
  ): T {
    const span = this.startSpan(name, { attributes });
    const ctx = RequestContextManager.get();
    const prevActiveSpanId = ctx?.activeSpanId;
    if (ctx) {
      ctx.activeSpanId = span.id;
    }

    try {
      const result = fn(span);
      return result;
    } catch (err) {
      span.recordException(err);
      throw err;
    } finally {
      if (ctx) {
        ctx.activeSpanId = prevActiveSpanId;
      }
      span.end();
    }
  }
}

let defaultTracer: Tracer | null = null;

export function getTracer(): Tracer {
  if (!defaultTracer) {
    defaultTracer = new Tracer();
  }
  return defaultTracer;
}
