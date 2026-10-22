import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {
  initApiTrace,
  apiTraceMiddleware,
  dashboardMiddleware,
  getLogger,
  resetConfig,
  shutdownApiTrace,
} from '../../src';

describe('Dashboard Integration', () => {
  let app: express.Express;

  before(() => {
    resetConfig();
    initApiTrace({
      serviceName: 'dashboard-test-app',
      environment: 'development',
      storage: {
        type: 'memory',
        inMemoryBufferSize: 500,
      },
      dashboard: {
        enabled: true,
        endpoint: '/logs',
        auth: {
          enabled: false,
        },
      },
    });

    app = express();
    app.use(apiTraceMiddleware());

    // Normal route to populate some logs
    app.get('/api/data', (req, res) => {
      res.json({ data: [1, 2, 3] });
    });

    // Mount Dashboard
    app.use('/logs', dashboardMiddleware());
  });

  after(async () => {
    await shutdownApiTrace();
  });

  it('should serve dashboard index.html', async () => {
    const res = await request(app).get('/logs').expect(200);
    assert.ok(res.text.includes('<!DOCTYPE html>'));
    assert.ok(res.text.includes('API Trace Studio'));
    assert.equal(res.headers['content-type'].includes('text/html'), true);
  });

  it('should serve dashboard CSS and JS assets', async () => {
    const cssRes = await request(app).get('/logs/style.css').expect(200);
    assert.equal(cssRes.headers['content-type'].includes('text/css'), true);
    assert.ok(cssRes.text.includes('--bg-primary'));

    const jsRes = await request(app).get('/logs/app.js').expect(200);
    assert.equal(jsRes.headers['content-type'].includes('javascript'), true);
    assert.ok(jsRes.text.includes('API Trace Studio'));
  });

  it('should return system stats via /logs/api/stats', async () => {
    // Generate a log first
    await request(app).get('/api/data').expect(200);

    const res = await request(app).get('/logs/api/stats').expect(200);
    const stats = res.body;

    assert.ok(stats.serviceName);
    assert.equal(stats.serviceName, 'dashboard-test-app');
    assert.equal(typeof stats.totalRequests, 'number');
    assert.ok(stats.totalRequests >= 1);
    assert.equal(typeof stats.errorRate, 'number');
    assert.equal(typeof stats.avgDurationMs, 'number');
  });

  it('should return paginated query results via /logs/api/logs', async () => {
    const res = await request(app).get('/logs/api/logs?page=1&limit=10').expect(200);
    const data = res.body;

    assert.equal(data.page, 1);
    assert.equal(data.limit, 10);
    assert.ok(Array.isArray(data.records));
    assert.ok(data.records.length >= 1);
    assert.equal(data.records[0].url, '/api/data');
  });

  it('should export logs as JSON and CSV via /logs/api/export', async () => {
    const jsonRes = await request(app).get('/logs/api/export?format=json').expect(200);
    assert.ok(jsonRes.headers['content-disposition'].includes('attachment'));
    assert.ok(Array.isArray(jsonRes.body));

    const csvRes = await request(app).get('/logs/api/export?format=csv').expect(200);
    assert.equal(csvRes.headers['content-type'].includes('text/csv'), true);
    assert.ok(csvRes.text.startsWith('id,timestamp,level,method,statusCode'));
  });

  it('should enforce authentication when auth is enabled', async () => {
    const authApp = express();
    resetConfig();
    initApiTrace({
      serviceName: 'auth-test-app',
      dashboard: {
        enabled: true,
        endpoint: '/secure-logs',
        auth: {
          enabled: true,
          username: 'admin',
          password: 'supersecretpassword',
        },
      },
    });

    authApp.use('/secure-logs', dashboardMiddleware());

    // Without credentials -> 401
    await request(authApp).get('/secure-logs').expect(401);
    await request(authApp).get('/secure-logs/api/stats').expect(401);

    // With invalid credentials -> 401
    await request(authApp)
      .get('/secure-logs')
      .auth('admin', 'wrongpass')
      .expect(401);

    // With valid Basic auth -> 200
    await request(authApp)
      .get('/secure-logs')
      .auth('admin', 'supersecretpassword')
      .expect(200);
  });
});
