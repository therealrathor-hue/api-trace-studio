import { initConfig, getConfig, setConfig, resetConfig, ApiTraceUserConfig, ApiTraceConfig } from './config';
import { getLogger, resetLogger, Logger } from './logger';
import { getTracer, Tracer } from './tracing/tracer';
import { instrumentOutboundHttp, restoreOutboundHttp } from './tracing/outbound-http';
import { setupGlobalErrorMonitoring, teardownGlobalErrorMonitoring } from './errors';
import {
  RequestContextManager,
  generateTraceId,
  generateSpanId,
  generateRequestId,
  parseTraceParent,
  formatTraceParent,
} from './context/request-context';
import { apiTraceMiddleware, apiTraceErrorMiddleware } from './middleware/express';
import { apiTraceFastifyPlugin } from './middleware/fastify';
import { ApiTraceInterceptor, ApiTraceExceptionFilter } from './middleware/nestjs';
import { dashboardMiddleware } from './dashboard/router';
import { startStandaloneDashboard } from './dashboard/standalone';
import { traceFunction, traceAsync, traceClass, Trace } from './tracing/function-tracer';
import { apiTraceMongoosePlugin } from './tracing/mongoose';
import { Redactor } from './security/redactor';

export interface InitResult {
  config: ApiTraceConfig;
  logger: Logger;
  tracer: Tracer;
}

/**
 * Main initialization entry point.
 * Call this once at the very top of your application before importing other modules.
 *
 * @example
 * const { initApiTrace } = require('api-trace-studio');
 * initApiTrace({ serviceName: 'my-service' });
 */
export function initApiTrace(userConfig?: ApiTraceUserConfig, configFile?: string): InitResult {
  resetLogger();
  const config = initConfig(userConfig, configFile);
  const logger = getLogger();
  logger.updateConfig(config);
  const tracer = getTracer();

  // Setup global error capturing
  if (config.errors.enabled) {
    setupGlobalErrorMonitoring();
  }

  // Instrument outbound HTTP / Fetch if configured
  if (config.outbound.enabled && (config.outbound.http || config.outbound.fetch)) {
    instrumentOutboundHttp();
  }

  return { config, logger, tracer };
}

/**
 * Gracefully shuts down file buffers and global listeners.
 */
export async function shutdownApiTrace(): Promise<void> {
  teardownGlobalErrorMonitoring();
  restoreOutboundHttp();
  resetLogger();
}

// Global logger shorthand
export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => getLogger().info(message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => getLogger().warn(message, meta),
  error: (message: string, error?: unknown, meta?: Record<string, unknown>) => getLogger().error(message, error, meta),
  debug: (message: string, meta?: Record<string, unknown>) => getLogger().debug(message, meta),
  trace: (message: string, meta?: Record<string, unknown>) => getLogger().trace(message, meta),
  fatal: (message: string, error?: unknown, meta?: Record<string, unknown>) => getLogger().fatal(message, error, meta),
};

// Shorthand context helpers
export const apiTrace = {
  getTraceId: () => RequestContextManager.getTraceId(),
  getRequestId: () => RequestContextManager.getRequestId(),
  addBreadcrumb: (message: string, category?: string, data?: Record<string, unknown>) =>
    RequestContextManager.addBreadcrumb(message, category, data),
  setTag: (key: string, value: unknown) => RequestContextManager.setTag(key, value),
  startSpan: (name: string, options?: any) => getTracer().startSpan(name, options),
  traceAsync: <T>(name: string, fn: (span: any) => Promise<T>, attrs?: any) =>
    getTracer().traceAsync(name, fn, attrs),
  traceSync: <T>(name: string, fn: (span: any) => T, attrs?: any) =>
    getTracer().traceSync(name, fn, attrs),
};

// Exports
export {
  // Config
  getConfig,
  setConfig,
  resetConfig,

  // Middleware
  apiTraceMiddleware,
  apiTraceErrorMiddleware,
  apiTraceFastifyPlugin,
  ApiTraceInterceptor,
  ApiTraceExceptionFilter,

  // Dashboard
  dashboardMiddleware,
  startStandaloneDashboard,

  // Tracing Wrappers
  traceFunction,
  traceAsync,
  traceClass,
  Trace,
  apiTraceMongoosePlugin,

  // Tracing & Context
  RequestContextManager,
  generateTraceId,
  generateSpanId,
  generateRequestId,
  parseTraceParent,
  formatTraceParent,
  getTracer,
  getLogger,
  resetLogger,
  Redactor,
  instrumentOutboundHttp,
  restoreOutboundHttp,
};

// Re-export all sub-modules for advanced usage
export * from './config/types';
export * from './context/types';
export * from './storage/types';
export * from './tracing/span';
