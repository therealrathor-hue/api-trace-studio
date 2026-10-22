import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import Fastify, { FastifyInstance } from 'fastify';
import {
  initApiTrace,
  apiTraceFastifyPlugin,
  getLogger,
  resetConfig,
  shutdownApiTrace,
} from '../../src';

describe('Fastify Plugin Integration', () => {
  let fastifyApp: FastifyInstance;

  before(async () => {
    resetConfig();
    initApiTrace({
      serviceName: 'fastify-test-app',
      environment: 'test',
      storage: {
        type: 'memory',
        inMemoryBufferSize: 500,
      },
      performance: {
        slowApiThresholdMs: 50,
      },
    });

    fastifyApp = Fastify();
    await fastifyApp.register(apiTraceFastifyPlugin);

    fastifyApp.get('/api/ping', async (request, reply) => {
      return { pong: true };
    });

    fastifyApp.post('/api/echo', async (request, reply) => {
      reply.status(201);
      return request.body;
    });

    await fastifyApp.ready();
  });

  after(async () => {
    await fastifyApp.close();
    await shutdownApiTrace();
  });

  it('should capture Fastify GET request and set trace headers', async () => {
    const res = await fastifyApp.inject({
      method: 'GET',
      url: '/api/ping',
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['x-request-id']);
    assert.ok(res.headers['x-trace-id']);
    assert.ok(res.headers['traceparent']);

    const ring = getLogger().getRingBuffer();
    const records = ring.toReversedArray();
    const found = records.find((r) => r.url === '/api/ping');

    assert.ok(found);
    assert.equal(found.method, 'GET');
    assert.equal(found.statusCode, 200);
    assert.equal(found.service, 'fastify-test-app');
  });

  it('should capture Fastify POST body and redact sensitive keys', async () => {
    const res = await fastifyApp.inject({
      method: 'POST',
      url: '/api/echo',
      payload: {
        username: 'alice',
        password: 'alice_super_secret',
      },
    });

    assert.equal(res.statusCode, 201);

    const ring = getLogger().getRingBuffer();
    const records = ring.toReversedArray();
    const found = records.find((r) => r.url === '/api/echo');

    assert.ok(found);
    assert.equal(found.method, 'POST');
    assert.equal(found.statusCode, 201);
    assert.ok(found.body);
    const body = found.body as any;
    assert.equal(body.username, 'alice');
    assert.equal(body.password, '[REDACTED]');
  });
});
