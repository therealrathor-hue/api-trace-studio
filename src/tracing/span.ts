import { TraceSpan } from '../context/types';
import { RequestContextManager, generateSpanId } from '../context/request-context';

export class Span {
  public readonly id: string;
  public readonly traceId: string;
  public readonly parentId?: string;
  public readonly name: string;
  public readonly kind: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  public readonly startTimeMs: number;
  public endTimeMs?: number;
  public durationMs?: number;
  public status: 'ok' | 'error' = 'ok';
  public attributes: Record<string, unknown> = {};
  public error?: { name: string; message: string; stack?: string };
  private isEnded = false;
  private startHr: bigint;

  constructor(
    name: string,
    options: {
      traceId?: string;
      parentId?: string;
      kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
      attributes?: Record<string, unknown>;
    } = {}
  ) {
    const ctx = RequestContextManager.get();
    this.name = name;
    this.id = generateSpanId();
    this.traceId = options.traceId || ctx?.traceId || generateSpanId() + generateSpanId();
    this.parentId = options.parentId || ctx?.activeSpanId || ctx?.spanId;
    this.kind = options.kind || 'internal';
    this.startTimeMs = Date.now();
    this.startHr = process.hrtime.bigint();

    if (options.attributes) {
      this.attributes = { ...options.attributes };
    }
  }

  public setAttribute(key: string, value: unknown): this {
    if (!this.isEnded) {
      this.attributes[key] = value;
    }
    return this;
  }

  public setAttributes(attrs: Record<string, unknown>): this {
    if (!this.isEnded) {
      Object.assign(this.attributes, attrs);
    }
    return this;
  }

  public recordException(err: unknown): this {
    this.status = 'error';
    if (err instanceof Error) {
      this.error = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    } else {
      this.error = {
        name: 'Error',
        message: String(err),
      };
    }
    return this;
  }

  public setStatus(status: 'ok' | 'error'): this {
    if (!this.isEnded) {
      this.status = status;
    }
    return this;
  }

  public end(): TraceSpan {
    if (this.isEnded) {
      return this.toJSON();
    }

    this.isEnded = true;
    this.endTimeMs = Date.now();
    const diffNs = process.hrtime.bigint() - this.startHr;
    this.durationMs = Math.round((Number(diffNs) / 1_000_000) * 100) / 100;

    const spanData = this.toJSON();
    RequestContextManager.addSpan(spanData);
    return spanData;
  }

  public toJSON(): TraceSpan {
    return {
      id: this.id,
      traceId: this.traceId,
      parentId: this.parentId,
      name: this.name,
      kind: this.kind,
      startTimeMs: this.startTimeMs,
      endTimeMs: this.endTimeMs,
      durationMs: this.durationMs,
      status: this.status,
      attributes: this.attributes,
      error: this.error,
    };
  }
}
