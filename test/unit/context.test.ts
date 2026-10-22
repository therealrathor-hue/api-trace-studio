import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  RequestContextManager,
  generateTraceId,
  generateSpanId,
  parseTraceParent,
  formatTraceParent,
  RequestContextData,
} from '../../src/context/request-context';

describe('Context Module', () => {
  it('should generate valid 32-hex traceId and 16-hex spanId', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();

    assert.equal(traceId.length, 32);
    assert.match(traceId, /^[0-9a-f]{32}$/);
    assert.equal(spanId.length, 16);
    assert.match(spanId, /^[0-9a-f]{16}$/);
  });

  it('should parse and format W3C traceparent headers', () => {
    const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const parsed = parseTraceParent(header);

    assert.ok(parsed);
    assert.equal(parsed.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.equal(parsed.parentSpanId, '00f067aa0ba902b7');

    const formatted = formatTraceParent(parsed.traceId, parsed.parentSpanId);
    assert.equal(formatted, header);
  });

  it('should return null for malformed traceparent headers', () => {
    assert.equal(parseTraceParent(undefined), null);
    assert.equal(parseTraceParent('invalid'), null);
    assert.equal(parseTraceParent('01-abc-123-01'), null);
    assert.equal(parseTraceParent('00-too-short-span-01'), null);
  });

  it('should propagate context across asynchronous boundaries', async () => {
    const traceId = generateTraceId();
    const mockCtx: RequestContextData = {
      traceId,
      requestId: 'req-123',
      spanId: generateSpanId(),
      startHrTime: process.hrtime.bigint(),
      startTimeIso: new Date().toISOString(),
      spans: [],
      breadcrumbs: [],
      tags: {},
      errorCaptured: false,
    };

    assert.equal(RequestContextManager.get(), undefined);

    await RequestContextManager.run(mockCtx, async () => {
      assert.equal(RequestContextManager.getTraceId(), traceId);
      assert.equal(RequestContextManager.getRequestId(), 'req-123');

      RequestContextManager.setTag('userId', 'user_456');
      RequestContextManager.addBreadcrumb('Step 1 complete', 'workflow');

      await new Promise((r) => setTimeout(r, 10));

      // Still available after async delay
      const current = RequestContextManager.get();
      assert.ok(current);
      assert.equal(current.tags['userId'], 'user_456');
      assert.equal(current.breadcrumbs.length, 1);
      assert.equal(current.breadcrumbs[0].message, 'Step 1 complete');
    });

    // Context cleared outside run
    assert.equal(RequestContextManager.get(), undefined);
  });
});
