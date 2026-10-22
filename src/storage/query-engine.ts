import * as fs from 'fs';
import * as readline from 'readline';
import { RingBuffer } from './ring-buffer';
import { FileWriter } from './file-writer';
import {
  ErrorSummary,
  LogQueryParams,
  LogQueryResult,
  LogRecord,
  SlowRouteSummary,
  SystemStats,
} from './types';

function computeErrorFingerprint(name: string, message: string, stack?: string): string {
  const firstFrame = stack ? stack.split('\n')[1] || '' : '';
  const cleanFrame = firstFrame.trim().replace(/^at\s+/, '');
  return `${name}:${message}:${cleanFrame}`;
}

export class QueryEngine {
  private ringBuffer: RingBuffer;
  private fileWriter?: FileWriter;

  constructor(ringBuffer: RingBuffer, fileWriter?: FileWriter) {
    this.ringBuffer = ringBuffer;
    this.fileWriter = fileWriter;
  }

  public matchesFilter(record: LogRecord, params: LogQueryParams): boolean {
    if (params.level && record.level.toLowerCase() !== params.level.toLowerCase()) {
      return false;
    }

    if (params.method && record.method && record.method.toUpperCase() !== params.method.toUpperCase()) {
      return false;
    }

    if (params.status !== undefined && params.status !== '') {
      const statusStr = String(params.status).toLowerCase();
      const recStatus = record.statusCode;
      if (recStatus === undefined) return false;

      if (statusStr === '2xx' && (recStatus < 200 || recStatus >= 300)) return false;
      if (statusStr === '3xx' && (recStatus < 300 || recStatus >= 400)) return false;
      if (statusStr === '4xx' && (recStatus < 400 || recStatus >= 500)) return false;
      if (statusStr === '5xx' && (recStatus < 500 || recStatus >= 600)) return false;
      if (!statusStr.endsWith('xx') && recStatus !== parseInt(statusStr, 10)) return false;
    }

    if (params.isSlow !== undefined) {
      if (params.isSlow && !record.isSlow) return false;
      if (!params.isSlow && record.isSlow) return false;
    }

    if (params.isError !== undefined) {
      const hasError = !!(record.error || (record.statusCode && record.statusCode >= 400) || record.level === 'error' || record.level === 'fatal');
      if (params.isError && !hasError) return false;
      if (!params.isError && hasError) return false;
    }

    if (params.route && record.route) {
      if (!record.route.toLowerCase().includes(params.route.toLowerCase())) {
        return false;
      }
    }

    if (params.traceId && record.traceId !== params.traceId) {
      return false;
    }

    if (params.requestId && record.requestId !== params.requestId) {
      return false;
    }

    if (params.startDate) {
      const start = new Date(params.startDate).getTime();
      const recTime = new Date(record.timestamp).getTime();
      if (recTime < start) return false;
    }

    if (params.endDate) {
      const end = new Date(params.endDate).getTime();
      const recTime = new Date(record.timestamp).getTime();
      if (recTime > end) return false;
    }

    if (params.search) {
      const term = params.search.toLowerCase();
      const inUrl = record.url ? record.url.toLowerCase().includes(term) : false;
      const inRoute = record.route ? record.route.toLowerCase().includes(term) : false;
      const inMsg = record.message ? record.message.toLowerCase().includes(term) : false;
      const inErrMsg = record.error?.message ? record.error.message.toLowerCase().includes(term) : false;
      const inTrace = record.traceId ? record.traceId.toLowerCase().includes(term) : false;
      const inReqId = record.requestId ? record.requestId.toLowerCase().includes(term) : false;
      if (!inUrl && !inRoute && !inMsg && !inErrMsg && !inTrace && !inReqId) {
        return false;
      }
    }

    return true;
  }

  public queryMemory(params: LogQueryParams = {}): LogQueryResult {
    let records = this.ringBuffer.toReversedArray();

    if (Object.keys(params).length > 0) {
      records = records.filter((r) => this.matchesFilter(r, params));
    }

    // Sort if specified
    const sortBy = params.sortBy || 'timestamp';
    const sortOrder = params.sortOrder || 'desc';

    if (sortBy !== 'timestamp' || sortOrder !== 'desc') {
      records.sort((a, b) => {
        let valA: any = a[sortBy as keyof LogRecord];
        let valB: any = b[sortBy as keyof LogRecord];

        if (sortBy === 'timestamp') {
          valA = new Date(a.timestamp).getTime();
          valB = new Date(b.timestamp).getTime();
        } else {
          valA = valA ?? 0;
          valB = valB ?? 0;
        }

        if (sortOrder === 'asc') {
          return valA > valB ? 1 : valA < valB ? -1 : 0;
        } else {
          return valA < valB ? 1 : valA > valB ? -1 : 0;
        }
      });
    }

    const total = records.length;
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(500, Math.max(1, params.limit || 25));
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedRecords = records.slice(startIndex, startIndex + limit);

    return {
      records: paginatedRecords,
      total,
      page,
      limit,
      totalPages,
    };
  }

  public async queryFiles(params: LogQueryParams = {}): Promise<LogQueryResult> {
    if (!this.fileWriter) {
      return this.queryMemory(params);
    }

    const files = this.fileWriter.getLogFiles();
    const matchedRecords: LogRecord[] = [];

    for (const filePath of files) {
      if (!fs.existsSync(filePath)) continue;

      const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const rec: LogRecord = JSON.parse(line);
          if (this.matchesFilter(rec, params)) {
            matchedRecords.push(rec);
          }
        } catch {
          // ignore corrupted lines
        }
      }
    }

    // Sort descending by default
    const sortBy = params.sortBy || 'timestamp';
    const sortOrder = params.sortOrder || 'desc';

    matchedRecords.sort((a, b) => {
      let valA: any = a[sortBy as keyof LogRecord];
      let valB: any = b[sortBy as keyof LogRecord];

      if (sortBy === 'timestamp') {
        valA = new Date(a.timestamp).getTime();
        valB = new Date(b.timestamp).getTime();
      } else {
        valA = valA ?? 0;
        valB = valB ?? 0;
      }

      if (sortOrder === 'asc') {
        return valA > valB ? 1 : valA < valB ? -1 : 0;
      } else {
        return valA < valB ? 1 : valA > valB ? -1 : 0;
      }
    });

    const total = matchedRecords.length;
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(500, Math.max(1, params.limit || 25));
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;

    return {
      records: matchedRecords.slice(startIndex, startIndex + limit),
      total,
      page,
      limit,
      totalPages,
    };
  }

  public getStats(): SystemStats {
    const records = this.ringBuffer.toArray();
    const httpRequests = records.filter((r) => r.type === 'http_request');
    const totalRequests = httpRequests.length;

    let errorCount = 0;
    let slowCount = 0;
    let totalDuration = 0;
    const durations: number[] = [];
    const statusCodeDistribution: Record<string, number> = {};
    const routeMap = new Map<string, { count: number; totalDuration: number; maxDuration: number; minDuration: number; method: string; route: string }>();
    const errorMap = new Map<string, ErrorSummary>();

    const now = Date.now();
    let oneMinuteAgoCount = 0;

    for (const req of httpRequests) {
      const recTime = new Date(req.timestamp).getTime();
      if (now - recTime <= 60000) {
        oneMinuteAgoCount++;
      }

      const dur = req.durationMs || 0;
      durations.push(dur);
      totalDuration += dur;

      if (req.isSlow) slowCount++;

      const isError = (req.statusCode && req.statusCode >= 400) || !!req.error;
      if (isError) errorCount++;

      if (req.statusCode) {
        const codeKey = String(req.statusCode);
        statusCodeDistribution[codeKey] = (statusCodeDistribution[codeKey] || 0) + 1;
      }

      const routeKey = `${req.method || 'GET'} ${req.route || req.url || 'unknown'}`;
      const existingRoute = routeMap.get(routeKey);
      if (existingRoute) {
        existingRoute.count++;
        existingRoute.totalDuration += dur;
        existingRoute.maxDuration = Math.max(existingRoute.maxDuration, dur);
        existingRoute.minDuration = Math.min(existingRoute.minDuration, dur);
      } else {
        routeMap.set(routeKey, {
          route: req.route || req.url || 'unknown',
          method: req.method || 'GET',
          count: 1,
          totalDuration: dur,
          maxDuration: dur,
          minDuration: dur,
        });
      }

      if (req.error) {
        const fp = computeErrorFingerprint(req.error.name, req.error.message, req.error.stack);
        const existingErr = errorMap.get(fp);
        if (existingErr) {
          existingErr.count++;
          existingErr.lastSeen = req.timestamp;
        } else {
          errorMap.set(fp, {
            fingerprint: fp,
            name: req.error.name,
            message: req.error.message,
            count: 1,
            firstSeen: req.timestamp,
            lastSeen: req.timestamp,
            sampleTraceId: req.traceId,
            route: req.route || req.url,
            stack: req.error.stack,
          });
        }
      }
    }

    // Also collect errors from app_log or error type records
    for (const rec of records) {
      if (rec.type === 'error' && rec.error) {
        const fp = computeErrorFingerprint(rec.error.name, rec.error.message, rec.error.stack);
        if (!errorMap.has(fp)) {
          errorMap.set(fp, {
            fingerprint: fp,
            name: rec.error.name,
            message: rec.error.message,
            count: 1,
            firstSeen: rec.timestamp,
            lastSeen: rec.timestamp,
            sampleTraceId: rec.traceId,
            route: rec.route || rec.url,
            stack: rec.error.stack,
          });
        }
      }
    }

    durations.sort((a, b) => a - b);
    const getPercentile = (pct: number): number => {
      if (durations.length === 0) return 0;
      const index = Math.ceil((pct / 100) * durations.length) - 1;
      return Math.round((durations[Math.max(0, index)] || 0) * 100) / 100;
    };

    const topSlowRoutes: SlowRouteSummary[] = Array.from(routeMap.values())
      .map((r) => ({
        route: r.route,
        method: r.method,
        count: r.count,
        avgDurationMs: Math.round((r.totalDuration / r.count) * 100) / 100,
        maxDurationMs: Math.round(r.maxDuration * 100) / 100,
        minDurationMs: Math.round(r.minDuration * 100) / 100,
      }))
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, 10);

    const topErrors: ErrorSummary[] = Array.from(errorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalRequests,
      errorCount,
      errorRate: totalRequests > 0 ? Math.round((errorCount / totalRequests) * 10000) / 100 : 0,
      slowCount,
      slowRate: totalRequests > 0 ? Math.round((slowCount / totalRequests) * 10000) / 100 : 0,
      avgDurationMs: totalRequests > 0 ? Math.round((totalDuration / totalRequests) * 100) / 100 : 0,
      p50DurationMs: getPercentile(50),
      p90DurationMs: getPercentile(90),
      p95DurationMs: getPercentile(95),
      p99DurationMs: getPercentile(99),
      requestsPerMinute: oneMinuteAgoCount,
      statusCodeDistribution,
      topSlowRoutes,
      topErrors,
    };
  }
}
