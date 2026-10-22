import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { ApiTraceConfig, LogLevel } from '../config/types';
import { getConfig } from '../config';
import { RequestContextManager, generateRequestId, generateTraceId } from '../context/request-context';
import { Redactor } from '../security/redactor';
import { FileWriter } from '../storage/file-writer';
import { QueryEngine } from '../storage/query-engine';
import { RingBuffer } from '../storage/ring-buffer';
import { LogRecord } from '../storage/types';
import { shouldLogLevel } from './types';

export class Logger extends EventEmitter {
  private config: ApiTraceConfig;
  private ringBuffer: RingBuffer;
  private fileWriter?: FileWriter;
  private queryEngine: QueryEngine;
  private redactor: Redactor;
  private isShutdown = false;

  constructor(config?: ApiTraceConfig) {
    super();
    this.config = config || getConfig();
    this.redactor = new Redactor(this.config.redaction);
    this.ringBuffer = new RingBuffer(this.config.storage.inMemoryBufferSize);

    if (this.config.storage.type === 'file' || this.config.storage.type === 'both') {
      this.fileWriter = new FileWriter(this.config.storage);
    }

    this.queryEngine = new QueryEngine(this.ringBuffer, this.fileWriter);
    this.setupGracefulShutdown();
  }

  private setupGracefulShutdown(): void {
    const handleExit = () => {
      if (!this.isShutdown) {
        this.closeSync();
      }
    };

    process.once('beforeExit', handleExit);
  }

  public updateConfig(newConfig: ApiTraceConfig): void {
    this.config = newConfig;
    this.redactor.updateConfig(newConfig.redaction);
  }

  public getRingBuffer(): RingBuffer {
    return this.ringBuffer;
  }

  public getFileWriter(): FileWriter | undefined {
    return this.fileWriter;
  }

  public getQueryEngine(): QueryEngine {
    return this.queryEngine;
  }

  public getRedactor(): Redactor {
    return this.redactor;
  }

  private shouldSample(isError: boolean, isSlow: boolean): boolean {
    const sampling = this.config.sampling;
    if (isError && sampling.alwaysSampleErrors) return true;
    if (isSlow && sampling.alwaysSampleSlow) return true;
    if (sampling.rate >= 1.0) return true;
    if (sampling.rate <= 0.0) return false;
    return Math.random() < sampling.rate;
  }

  public emitRecord(record: LogRecord): void {
    if (this.isShutdown) return;

    const isError = record.level === 'error' || record.level === 'fatal' || !!record.error || (record.statusCode && record.statusCode >= 400);
    const isSlow = !!record.isSlow;

    if (!this.shouldSample(!!isError, isSlow)) {
      return;
    }

    // Always push to in-memory ring buffer
    this.ringBuffer.push(record);

    // Push to file if enabled
    if (this.fileWriter) {
      this.fileWriter.write(record);
    }

    // Emit event for SSE or subscribers
    this.emit('record', record);
  }

  public logRequest(record: LogRecord): void {
    // Redact headers, body, query, tags, error message
    const cleanRecord: LogRecord = {
      ...record,
      headers: record.headers ? (this.redactor.redactHeaders(record.headers) as Record<string, unknown>) : undefined,
      query: record.query ? (this.redactor.redact(record.query) as Record<string, unknown>) : undefined,
      body: record.body ? this.redactor.redact(record.body) : undefined,
      tags: record.tags ? (this.redactor.redact(record.tags) as Record<string, unknown>) : undefined,
      spans: record.spans ? (this.redactor.redact(record.spans) as any) : undefined,
      error: record.error
        ? {
            name: record.error.name,
            message: this.redactor.maskStringPatterns(record.error.message),
            stack: record.error.stack ? this.redactor.maskStringPatterns(record.error.stack) : undefined,
            code: record.error.code,
            statusCode: record.error.statusCode,
          }
        : undefined,
    };

    this.emitRecord(cleanRecord);
  }

  public log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!shouldLogLevel(this.config.logLevel, level)) {
      return;
    }

    const ctx = RequestContextManager.get();
    const traceId = ctx?.traceId || generateTraceId();
    const requestId = ctx?.requestId || generateRequestId();

    const record: LogRecord = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      timestamp: new Date().toISOString(),
      level,
      service: this.config.serviceName,
      env: this.config.environment,
      type: 'app_log',
      traceId,
      requestId,
      message: this.redactor.maskStringPatterns(message),
      tags: meta ? (this.redactor.redact(meta) as Record<string, unknown>) : undefined,
    };

    // If meta contains an Error object
    if (meta && meta.error instanceof Error) {
      const err = meta.error;
      record.error = {
        name: err.name,
        message: this.redactor.maskStringPatterns(err.message),
        stack: err.stack ? this.redactor.maskStringPatterns(err.stack) : undefined,
      };
    }

    this.emitRecord(record);
  }

  public trace(message: string, meta?: Record<string, unknown>): void {
    this.log('trace', message, meta);
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  public error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const combinedMeta: Record<string, unknown> = { ...meta };
    if (error) {
      if (error instanceof Error) {
        combinedMeta.error = error;
      } else {
        combinedMeta.error = new Error(String(error));
      }
    }
    this.log('error', message, combinedMeta);
  }

  public fatal(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const combinedMeta: Record<string, unknown> = { ...meta };
    if (error) {
      if (error instanceof Error) {
        combinedMeta.error = error;
      } else {
        combinedMeta.error = new Error(String(error));
      }
    }
    this.log('fatal', message, combinedMeta);
  }

  public async flush(): Promise<void> {
    if (this.fileWriter) {
      await this.fileWriter.flush();
    }
  }

  public closeSync(): void {
    this.isShutdown = true;
    if (this.fileWriter) {
      this.fileWriter.flushSync();
    }
  }

  public async close(): Promise<void> {
    this.isShutdown = true;
    if (this.fileWriter) {
      await this.fileWriter.close();
    }
  }
}

let defaultLogger: Logger | null = null;

export function getLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger();
  }
  return defaultLogger;
}

export function resetLogger(): void {
  if (defaultLogger) {
    defaultLogger.closeSync();
    defaultLogger = null;
  }
}

export * from './types';
