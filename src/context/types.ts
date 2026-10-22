export interface TraceSpan {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  kind: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  startTimeMs: number;
  endTimeMs?: number;
  durationMs?: number;
  status: 'ok' | 'error';
  attributes: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface Breadcrumb {
  timestamp: string;
  message: string;
  category?: string;
  level?: 'info' | 'warn' | 'error';
  data?: Record<string, unknown>;
}

export interface RequestContextData {
  traceId: string;
  requestId: string;
  spanId: string;
  parentSpanId?: string;
  startHrTime: bigint;
  startTimeIso: string;
  method?: string;
  url?: string;
  route?: string;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  clientIp?: string;
  statusCode?: number;
  durationMs?: number;
  spans: TraceSpan[];
  breadcrumbs: Breadcrumb[];
  tags: Record<string, unknown>;
  errorCaptured: boolean;
  error?: unknown;
  activeSpanId?: string;
}
