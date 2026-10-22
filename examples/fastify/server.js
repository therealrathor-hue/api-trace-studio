/**
 * API Trace Studio - Fastify Example
 * Run:
 *   node examples/fastify/server.js
 */

const Fastify = require('fastify');
const {
  initApiTrace,
  apiTraceFastifyPlugin,
} = require('../../dist');

// 1. Initialize API Trace Studio
initApiTrace({
  serviceName: 'fastify-microservice',
  environment: 'development',
});

const app = Fastify({ logger: false });

async function start() {
  // 2. Register Fastify plugin
  await app.register(apiTraceFastifyPlugin);

  // Routes
  app.get('/api/health', async () => ({ status: 'healthy' }));

  app.get('/api/items', async () => [
    { id: 'item_1', name: 'Widget A' },
    { id: 'item_2', name: 'Widget B' },
  ]);

  app.post('/api/items', async (request, reply) => {
    reply.status(201);
    return { created: true, item: request.body };
  });

  const PORT = 3002;
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Fastify App running on http://localhost:${PORT}`);
}

start().catch(console.error);
