import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { RingBuffer } from '../../src/storage/ring-buffer';
import { QueryEngine } from '../../src/storage/query-engine';
import { LogRecord } from '../../src/storage/types';

describe('QueryEngine Module', () => {
  let ring: RingBuffer;
  let engine: QueryEngine;

  beforeEach(() => {
    ring = new RingBuffer(100);
    engine = new QueryEngine(ring);

    // Seed mock data
    const seedRecords: LogRecord[] = [
      {
        id: '1',
        timestamp: '2026-10-22T10:00:00.000Z',
        level: 'info',
        service: 'test-svc',
        env: 'prod',
        type: 'http_request',
        traceId: 'tr-1',
        requestId: 'req-1',
        method: 'GET',
        url: '/api/users',
        route: '/api/users',
        statusCode: 200,
        durationMs: 45.0,
        isSlow: false,
      },
      {
        id: '2',
        timestamp: '2026-10-22T10:01:00.000Z',
        level: 'warn',
        service: 'test-svc',
        env: 'prod',
        type: 'http_request',
        traceId: 'tr-2',
        requestId: 'req-2',
        method: 'POST',
        url: '/api/users',
        route: '/api/users',
        statusCode: 400,
        durationMs: 120.0,
        isSlow: false,
        error: { name: 'ValidationError', message: 'Invalid email' },
      },
      {
        id: '3',
        timestamp: '2026-10-22T10:02:00.000Z',
        level: 'error',
        service: 'test-svc',
        env: 'prod',
        type: 'http_request',
        traceId: 'tr-3',
        requestId: 'req-3',
        method: 'GET',
        url: '/api/reports/heavy',
        route: '/api/reports/heavy',
        statusCode: 500,
        durationMs: 1450.0,
        isSlow: true,
        error: { name: 'DatabaseTimeout', message: 'Query exceeded 1000ms' },
      },
    ];

    for (const r of seedRecords) {
      ring.push(r);
    }
  });

  it('should filter logs by method, status, level, slow, error', () => {
    // By method
    const getLogs = engine.queryMemory({ method: 'GET' });
    assert.equal(getLogs.total, 2);

    // By status range 4xx
    const err4xx = engine.queryMemory({ status: '4xx' });
    assert.equal(err4xx.total, 1);
    assert.equal(err4xx.records[0].id, '2');

    // By slow flag
    const slowLogs = engine.queryMemory({ isSlow: true });
    assert.equal(slowLogs.total, 1);
    assert.equal(slowLogs.records[0].id, '3');

    // By isError
    const errorLogs = engine.queryMemory({ isError: true });
    assert.equal(errorLogs.total, 2); // 400 and 500
  });

  it('should search across URL, route, and error messages', () => {
    const searchReport = engine.queryMemory({ search: 'heavy' });
    assert.equal(searchReport.total, 1);
    assert.equal(searchReport.records[0].id, '3');

    const searchError = engine.queryMemory({ search: 'Invalid email' });
    assert.equal(searchError.total, 1);
    assert.equal(searchError.records[0].id, '2');
  });

  it('should paginate results correctly', () => {
    const page1 = engine.queryMemory({ page: 1, limit: 2 });
    assert.equal(page1.records.length, 2);
    assert.equal(page1.totalPages, 2);

    const page2 = engine.queryMemory({ page: 2, limit: 2 });
    assert.equal(page2.records.length, 1);
  });

  it('should calculate accurate system statistics and aggregations', () => {
    const stats = engine.getStats();

    assert.equal(stats.totalRequests, 3);
    assert.equal(stats.slowCount, 1);
    assert.equal(stats.errorCount, 2); // 400 and 500
    assert.ok(stats.avgDurationMs > 500); // (45 + 120 + 1450) / 3 = 538.33
    assert.equal(stats.statusCodeDistribution['200'], 1);
    assert.equal(stats.statusCodeDistribution['400'], 1);
    assert.equal(stats.statusCodeDistribution['500'], 1);

    assert.ok(stats.topSlowRoutes.length >= 1);
    assert.equal(stats.topSlowRoutes[0].route, '/api/reports/heavy');
    assert.equal(stats.topErrors.length, 2);
  });
});
