import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'http';
import {
  initApiTrace,
  RequestContextManager,
  generateTraceId,
  generateSpanId,
  shutdownApiTrace,
  resetConfig,
} from '../../src';

describe('Outbound HTTP Tracing Integration', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let receivedHeaders: Record<string, any> = {};

  before(async () => {
    resetConfig();
    initApiTrace({
      serviceName: 'outbound-test-service',
      outbound: {
        enabled: true,
        http: true,
        fetch: true,
        propagateTraceContext: true,
      },
    });

    targetServer = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        const addr = targetServer.address() as any;
        targetPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => targetServer.close(resolve));
    await shutdownApiTrace();
  });

  it('should intercept outbound http.request and inject distributed trace context', async () => {
    const traceId = generateTraceId();
    const requestId = 'req-distributed-test';

    const mockCtx = {
      traceId,
      requestId,
      spanId: generateSpanId(),
      startHrTime: process.hrtime.bigint(),
      startTimeIso: new Date().toISOString(),
      spans: [],
      breadcrumbs: [],
      tags: {},
      errorCaptured: false,
    };

    await RequestContextManager.run(mockCtx, async () => {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: targetPort,
            path: '/target-endpoint',
            method: 'GET',
          },
          (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
          }
        );
        req.on('error', reject);
        req.end();
      });

      // Check that span was recorded in context
      assert.ok(mockCtx.spans.length >= 1);
      const span = mockCtx.spans[0];
      assert.ok(span.name.startsWith('HTTP GET'));
      assert.equal(span.kind, 'client');
      assert.equal(span.attributes['http.status_code'], 200);

      // Check that trace headers were propagated to the downstream server
      assert.equal(receivedHeaders['x-request-id'], requestId);
      assert.ok(receivedHeaders['traceparent']);
      assert.ok(receivedHeaders['traceparent'].startsWith(`00-${traceId}-`));
    });
  });
});
