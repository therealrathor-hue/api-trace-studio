import { LogLevel } from '../config/types';
import { Breadcrumb, TraceSpan } from '../context/types';

export interface LogRecord {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  env: string;
  type: 'http_request' | 'app_log' | 'error' | 'span';
  traceId: string;
  requestId: string;
  method?: string;
  url?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  isSlow?: boolean;
  clientIp?: string;
  userAgent?: string;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  spans?: TraceSpan[];
  breadcrumbs?: Breadcrumb[];
  tags?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
    statusCode?: number;
  };
  message?: string;
}

export interface LogQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  level?: string;
  status?: string | number;
  method?: string;
  isSlow?: boolean;
  isError?: boolean;
  route?: string;
  traceId?: string;
  requestId?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: 'timestamp' | 'durationMs' | 'statusCode';
  sortOrder?: 'asc' | 'desc';
}

export interface LogQueryResult {
  records: LogRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SlowRouteSummary {
  route: string;
  method: string;
  count: number;
  avgDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number;
}

export interface ErrorSummary {
  fingerprint: string;
  name: string;
  message: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sampleTraceId?: string;
  route?: string;
  stack?: string;
}

export interface SystemStats {
  totalRequests: number;
  errorCount: number;
  errorRate: number; // percentage
  slowCount: number;
  slowRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p90DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  requestsPerMinute: number;
  statusCodeDistribution: Record<string, number>;
  topSlowRoutes: SlowRouteSummary[];
  topErrors: ErrorSummary[];
}
