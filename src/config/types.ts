export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface StorageConfig {
  type: 'file' | 'memory' | 'both';
  directory: string;
  filename: string;
  maxSizeBytes: number; // e.g. 10 * 1024 * 1024 (10MB)
  maxFiles: number; // e.g. 14 days or files
  compress: boolean;
  inMemoryBufferSize: number; // e.g. 2000 records
  flushIntervalMs: number; // e.g. 1000ms
}

export interface DashboardAuthConfig {
  enabled: boolean;
  username?: string;
  password?: string;
  token?: string;
}

export interface DashboardConfig {
  enabled: boolean;
  endpoint: string; // e.g. '/logs'
  title: string;
  auth: DashboardAuthConfig;
  pollingIntervalMs: number;
  sseEnabled: boolean;
}

export interface PerformanceConfig {
  slowApiThresholdMs: number; // default 1000ms
  slowFunctionThresholdMs: number; // default 200ms
  slowDbThresholdMs: number; // default 500ms
  slowOutboundThresholdMs: number; // default 800ms
}

export interface RedactionConfig {
  enabled: boolean;
  keys: string[]; // sensitive keys to redact in objects
  maskHeaders: string[]; // headers to mask
  replacement: string; // e.g. '[REDACTED]'
  maskPatterns: boolean; // whether to mask credit cards, JWTs, etc. in string values
  customRedactor?: (key: string, value: unknown) => unknown;
}

export interface TracingConfig {
  enabled: boolean;
  captureHeaders: string[]; // headers to log with requests
  captureRequestBody: boolean;
  captureResponseBody: boolean;
  maxBodySize: number; // max body size in bytes to log (e.g. 64KB)
  useOpenTelemetry: boolean;
}

export interface DatabaseConfig {
  enabled: boolean;
  mongoose: boolean;
}

export interface OutboundConfig {
  enabled: boolean;
  http: boolean;
  fetch: boolean;
  propagateTraceContext: boolean;
}

export interface SamplingConfig {
  rate: number; // 0.0 to 1.0 (1.0 = 100%)
  alwaysSampleErrors: boolean;
  alwaysSampleSlow: boolean;
}

export interface ErrorMonitoringConfig {
  enabled: boolean;
  captureUncaughtExceptions: boolean;
  captureUnhandledRejections: boolean;
  deduplicate: boolean;
}

export interface ApiTraceConfig {
  serviceName: string;
  environment: string;
  logLevel: LogLevel;
  storage: StorageConfig;
  dashboard: DashboardConfig;
  performance: PerformanceConfig;
  redaction: RedactionConfig;
  tracing: TracingConfig;
  database: DatabaseConfig;
  outbound: OutboundConfig;
  sampling: SamplingConfig;
  errors: ErrorMonitoringConfig;
  ignoreRoutes: string[]; // routes to skip logging entirely
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type ApiTraceUserConfig = DeepPartial<ApiTraceConfig>;
