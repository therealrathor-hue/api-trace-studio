import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import express, { Request, Response } from 'express';
import request from 'supertest';
import {
  initApiTrace,
  apiTraceMiddleware,
  apiTraceErrorMiddleware,
  getLogger,
  resetConfig,
  shutdownApiTrace,
} from '../../src';

describe('Express Middleware Integration', () => {
  let app: express.Express;

  before(() => {
    resetConfig();
    initApiTrace({
      serviceName: 'test-express-app',
      environment: 'test',
      storage: {
        type: 'memory',
        inMemoryBufferSize: 500,
      },
      performance: {
        slowApiThresholdMs: 50, // 50ms for testing slow routes
      },
      ignoreRoutes: ['/health', '/metrics'],
    });

    app = express();
    app.use(express.json());
    app.use(apiTraceMiddleware());

    // Normal Route
    app.get('/api/hello', (req: Request, res: Response) => {
      res.json({ message: 'world' });
    });

    // Post Route with sensitive fields
    app.post('/api/users', (req: Request, res: Response) => {
      res.status(201).json({ created: true });
    });

    // Slow Route
    app.get('/api/slow', async (req: Request, res: Response) => {
      await new Promise((r) => setTimeout(r, 70));
      res.json({ slow: true });
    });

    // Error Route
    app.get('/api/fail', (req: Request, res: Response, next) => {
      const err = new Error('Database connection exploded');
      next(err);
    });

    // Ignored Route
    app.get('/health', (req: Request, res: Response) => {
      res.send('OK');
    });

    // Error middleware
    app.use(apiTraceErrorMiddleware());
    app.use((err: any, req: Request, res: Response, next: any) => {
      res.status(500).json({ error: err.message });
    });
  });

  after(async () => {
    await shutdownApiTrace();
  });

  it('should capture incoming request and set response headers', async () => {
    const res = await request(app).get('/api/hello').expect(200);

    assert.ok(res.headers['x-request-id']);
    assert.ok(res.headers['x-trace-id']);
    assert.ok(res.headers['traceparent']);
    assert.match(res.headers['traceparent'], /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    const ring = getLogger().getRingBuffer();
    const records = ring.toReversedArray();
    const found = records.find((r) => r.url === '/api/hello');

    assert.ok(found);
    assert.equal(found.method, 'GET');
    assert.equal(found.statusCode, 200);
    assert.equal(found.isSlow, false);
    assert.ok(found.durationMs !== undefined && found.durationMs >= 0);
  });

  it('should redact sensitive fields in request body', async () => {
    await request(app)
      .post('/api/users')
      .send({
        username: 'john_doe',
        password: 'supersecretpassword123',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.def',
      })
      .expect(201);

    const ring = getLogger().getRingBuffer();
    const records = ring.toReversedArray();
    const found = records.find((r) => r.url === '/api/users');

    assert.ok(found);
    assert.ok(found.body);
    const body = found.body as any;
    assert.equal(body.username, 'john_doe');
    assert.equal(body.password, '[REDACTED]');
    assert.equal(body.token, '[REDACTED]');
  });

  it('should flag slow route when exceeding slowApiThresholdMs', async () => {
    await request(app).get('/api/slow').expect(200);

    const ring = getLogger().getRingBuffer();
    const records = ring.toReversedArray();
    const found = records.find((r) => r.url === '/api/slow');

    assert.ok(found);
    assert.equal(found.isSlow, true);
    assert.ok(found.durationMs! >= 50);
  });

  it('should capture error details on failing route', async () => {
    await request(app).get('/api/fail').expect(500);

    const ring = getLogger().getRingBuffer();
    const records = ring.toReversedArray();
    const found = records.find((r) => r.url === '/api/fail');

    assert.ok(found);
    assert.equal(found.statusCode, 500);
    assert.equal(found.level, 'error');
    assert.ok(found.error);
    assert.equal(found.error.name, 'Error');
    assert.equal(found.error.message, 'Database connection exploded');
    assert.ok(found.error.stack);
  });

  it('should ignore configured ignored routes', async () => {
    const beforeCount = getLogger().getRingBuffer().size();
    await request(app).get('/health').expect(200);
    const afterCount = getLogger().getRingBuffer().size();

    assert.equal(afterCount, beforeCount, 'Ignored route should not create a log entry');
  });
});
