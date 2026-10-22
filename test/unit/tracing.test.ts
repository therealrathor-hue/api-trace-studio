import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  traceFunction,
  traceAsync,
  traceClass,
} from '../../src/tracing/function-tracer';
import { RequestContextManager, generateSpanId, generateTraceId } from '../../src/context/request-context';

describe('Tracing Module', () => {
  it('should wrap synchronous function and record span', () => {
    const mockCtx = {
      traceId: generateTraceId(),
      requestId: 'req-1',
      spanId: generateSpanId(),
      startHrTime: process.hrtime.bigint(),
      startTimeIso: new Date().toISOString(),
      spans: [],
      breadcrumbs: [],
      tags: {},
      errorCaptured: false,
    };

    RequestContextManager.run(mockCtx, () => {
      function calculateSum(a: number, b: number): number {
        return a + b;
      }

      const tracedSum = traceFunction('calculateSum', calculateSum, {
        captureArgs: true,
        captureResult: true,
      });

      const res = tracedSum(10, 20);
      assert.equal(res, 30);

      assert.equal(mockCtx.spans.length, 1);
      const span = mockCtx.spans[0];
      assert.equal(span.name, 'calculateSum');
      assert.equal(span.status, 'ok');
      assert.ok(span.durationMs !== undefined);
      assert.deepEqual(span.attributes['args'], [10, 20]);
      assert.equal(span.attributes['result'], 30);
    });
  });

  it('should wrap asynchronous function and record span timing & errors', async () => {
    const mockCtx = {
      traceId: generateTraceId(),
      requestId: 'req-2',
      spanId: generateSpanId(),
      startHrTime: process.hrtime.bigint(),
      startTimeIso: new Date().toISOString(),
      spans: [],
      breadcrumbs: [],
      tags: {},
      errorCaptured: false,
    };

    await RequestContextManager.run(mockCtx, async () => {
      async function failingTask(): Promise<string> {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error('Database connection failed');
      }

      const tracedFail = traceAsync('failingTask', failingTask);

      await assert.rejects(
        async () => {
          await tracedFail();
        },
        {
          name: 'Error',
          message: 'Database connection failed',
        }
      );

      assert.equal(mockCtx.spans.length, 1);
      const span = mockCtx.spans[0];
      assert.equal(span.name, 'failingTask');
      assert.equal(span.status, 'error');
      assert.equal(span.error?.message, 'Database connection failed');
    });
  });

  it('should wrap class methods with traceClass', async () => {
    const mockCtx = {
      traceId: generateTraceId(),
      requestId: 'req-3',
      spanId: generateSpanId(),
      startHrTime: process.hrtime.bigint(),
      startTimeIso: new Date().toISOString(),
      spans: [],
      breadcrumbs: [],
      tags: {},
      errorCaptured: false,
    };

    class UserService {
      public getUser(id: string): { id: string; name: string } {
        return { id, name: 'Alice' };
      }

      public async saveUser(user: { name: string }): Promise<boolean> {
        await new Promise((r) => setTimeout(r, 5));
        return true;
      }
    }

    const TracedService = traceClass(UserService);
    const instance = new TracedService();

    await RequestContextManager.run(mockCtx, async () => {
      const u = instance.getUser('42');
      assert.equal(u.name, 'Alice');

      const saved = await instance.saveUser({ name: 'Bob' });
      assert.equal(saved, true);

      assert.equal(mockCtx.spans.length, 2);
      assert.equal(mockCtx.spans[0].name, 'UserService.getUser');
      assert.equal(mockCtx.spans[1].name, 'UserService.saveUser');
    });
  });
});
