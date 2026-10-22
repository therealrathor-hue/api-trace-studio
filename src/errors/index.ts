import { getLogger } from '../logger';
import { RequestContextManager } from '../context/request-context';
import { getConfig } from '../config';

interface ErrorFingerprintEntry {
  fingerprint: string;
  timestamp: number;
}

const recentErrors: ErrorFingerprintEntry[] = [];
let isGlobalMonitoringSetup = false;
let uncaughtHandler: ((err: Error) => void) | null = null;
let unhandledHandler: ((reason: unknown) => void) | null = null;

export function serializeError(err: unknown): {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  statusCode?: number;
} {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: (err as any).code,
      statusCode: (err as any).statusCode || (err as any).status,
    };
  }

  if (err && typeof err === 'object') {
    const obj = err as Record<string, any>;
    return {
      name: typeof obj.name === 'string' ? obj.name : 'Error',
      message: typeof obj.message === 'string' ? obj.message : String(err),
      stack: typeof obj.stack === 'string' ? obj.stack : undefined,
      code: obj.code,
      statusCode: obj.statusCode || obj.status,
    };
  }

  return {
    name: 'Error',
    message: String(err),
  };
}

export function computeErrorFingerprint(err: unknown): string {
  const serialized = serializeError(err);
  const firstFrame = serialized.stack ? serialized.stack.split('\n')[1] || '' : '';
  const cleanFrame = firstFrame.trim().replace(/^at\s+/, '');
  return `${serialized.name}:${serialized.message}:${cleanFrame}`;
}

export function isDuplicateError(err: unknown, windowMs: number = 1000): boolean {
  const fp = computeErrorFingerprint(err);
  const now = Date.now();

  // Prune older than windowMs
  const validThreshold = now - windowMs;
  while (recentErrors.length > 0 && recentErrors[0].timestamp < validThreshold) {
    recentErrors.shift();
  }

  // Check if fingerprint exists in recent window
  for (const entry of recentErrors) {
    if (entry.fingerprint === fp) {
      return true;
    }
  }

  // Record it
  recentErrors.push({ fingerprint: fp, timestamp: now });
  return false;
}

export function recordCapturedError(err: unknown): void {
  const ctx = RequestContextManager.get();
  if (ctx) {
    ctx.error = serializeError(err);
    ctx.errorCaptured = true;
  }
}

export function setupGlobalErrorMonitoring(): void {
  if (isGlobalMonitoringSetup) return;
  const config = getConfig();
  if (!config.errors.enabled) return;

  const logger = getLogger();

  if (config.errors.captureUnhandledRejections) {
    unhandledHandler = (reason: unknown) => {
      if (config.errors.deduplicate && isDuplicateError(reason)) {
        return;
      }

      const serialized = serializeError(reason);
      logger.error(`[Unhandled Rejection] ${serialized.message}`, reason, {
        type: 'unhandled_rejection',
        error: serialized,
      });
    };
    process.on('unhandledRejection', unhandledHandler);
  }

  if (config.errors.captureUncaughtExceptions) {
    uncaughtHandler = (err: Error) => {
      if (config.errors.deduplicate && isDuplicateError(err)) {
        return;
      }

      const serialized = serializeError(err);
      logger.fatal(`[Uncaught Exception] ${serialized.message}`, err, {
        type: 'uncaught_exception',
        error: serialized,
      });
    };
    process.on('uncaughtException', uncaughtHandler);
  }

  isGlobalMonitoringSetup = true;
}

export function teardownGlobalErrorMonitoring(): void {
  if (unhandledHandler) {
    process.removeListener('unhandledRejection', unhandledHandler);
    unhandledHandler = null;
  }
  if (uncaughtHandler) {
    process.removeListener('uncaughtException', uncaughtHandler);
    uncaughtHandler = null;
  }
  isGlobalMonitoringSetup = false;
}
