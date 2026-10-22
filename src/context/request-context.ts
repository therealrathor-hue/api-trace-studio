import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';
import { RequestContextData, TraceSpan, Breadcrumb } from './types';

const asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

export function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function generateRequestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/**
 * Parses W3C traceparent header:
 * Format: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
export function parseTraceParent(header?: string): { traceId: string; parentSpanId: string } | null {
  if (!header || typeof header !== 'string') return null;
  const parts = header.trim().split('-');
  if (parts.length < 4 || parts[0] !== '00') return null;

  const traceId = parts[1];
  const parentSpanId = parts[2];

  if (traceId.length === 32 && /^[0-9a-fA-F]+$/.test(traceId) && parentSpanId.length === 16 && /^[0-9a-fA-F]+$/.test(parentSpanId)) {
    return { traceId: traceId.toLowerCase(), parentSpanId: parentSpanId.toLowerCase() };
  }

  return null;
}

export function formatTraceParent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

export function getDurationMs(startHr: bigint): number {
  const diffNs = process.hrtime.bigint() - startHr;
  return Number(diffNs) / 1_000_000;
}

export class RequestContextManager {
  public static run<T>(context: RequestContextData, fn: () => T): T {
    return asyncLocalStorage.run(context, fn);
  }

  public static get(): RequestContextData | undefined {
    return asyncLocalStorage.getStore();
  }

  public static getTraceId(): string | undefined {
    return asyncLocalStorage.getStore()?.traceId;
  }

  public static getRequestId(): string | undefined {
    return asyncLocalStorage.getStore()?.requestId;
  }

  public static addSpan(span: TraceSpan): void {
    const ctx = asyncLocalStorage.getStore();
    if (ctx) {
      ctx.spans.push(span);
    }
  }

  public static addBreadcrumb(
    message: string,
    category = 'default',
    data?: Record<string, unknown>,
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    const ctx = asyncLocalStorage.getStore();
    if (ctx) {
      const bc: Breadcrumb = {
        timestamp: new Date().toISOString(),
        message,
        category,
        level,
        data,
      };
      ctx.breadcrumbs.push(bc);
    }
  }

  public static setTag(key: string, value: unknown): void {
    const ctx = asyncLocalStorage.getStore();
    if (ctx) {
      ctx.tags[key] = value;
    }
  }

  public static setError(err: unknown): void {
    const ctx = asyncLocalStorage.getStore();
    if (ctx) {
      ctx.error = err;
      ctx.errorCaptured = true;
    }
  }

  public static isErrorCaptured(): boolean {
    return !!asyncLocalStorage.getStore()?.errorCaptured;
  }
}

export { asyncLocalStorage };
export * from './types';
