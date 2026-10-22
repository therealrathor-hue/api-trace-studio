import * as fs from 'fs';
import * as path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { getConfig } from '../config';
import { getLogger } from '../logger';
import { verifyDashboardAuth } from '../security/auth';
import { safeResolvePath } from '../security/sanitizer';
import { LogQueryParams, LogRecord } from '../storage/types';

function findPublicDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../public'),
    path.resolve(__dirname, '../public'),
    path.resolve(__dirname, '../../../public'),
    path.resolve(process.cwd(), 'public'),
    path.resolve(process.cwd(), 'node_modules/api-trace-studio/public'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }

  return path.resolve(__dirname, '../../public');
}

function parseUrlParams(urlStr: string): { pathname: string; query: Record<string, string> } {
  const [pathname, queryString] = urlStr.split('?');
  const query: Record<string, string> = {};

  if (queryString) {
    const pairs = queryString.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        query[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
      }
    }
  }

  return { pathname, query };
}

function convertLogsToCsv(records: LogRecord[]): string {
  const headers = ['id', 'timestamp', 'level', 'method', 'statusCode', 'durationMs', 'route', 'url', 'clientIp', 'isSlow', 'error'];
  const lines = [headers.join(',')];

  for (const r of records) {
    const row = [
      JSON.stringify(r.id || ''),
      JSON.stringify(r.timestamp || ''),
      JSON.stringify(r.level || ''),
      JSON.stringify(r.method || ''),
      JSON.stringify(r.statusCode || ''),
      JSON.stringify(r.durationMs || ''),
      JSON.stringify(r.route || ''),
      JSON.stringify(r.url || ''),
      JSON.stringify(r.clientIp || ''),
      JSON.stringify(r.isSlow ? 'true' : 'false'),
      JSON.stringify(r.error ? `${r.error.name}: ${r.error.message}` : ''),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

export function dashboardMiddleware(customOptions?: { title?: string }) {
  const publicDir = findPublicDir();

  return function (req: any, res: any, next?: () => void): void {
    const config = getConfig();

    // Check if dashboard is enabled
    if (!config.dashboard.enabled) {
      if (typeof next === 'function') return next();
      res.statusCode = 404;
      res.end('Dashboard is disabled');
      return;
    }

    // Relative path inside dashboard router
    const fullUrl = req.originalUrl || req.url || '/';
    const { pathname, query } = parseUrlParams(fullUrl);

    // Normalize path relative to dashboard endpoint
    let subPath = pathname;
    if (config.dashboard.endpoint && subPath.startsWith(config.dashboard.endpoint)) {
      subPath = subPath.slice(config.dashboard.endpoint.length);
    }
    if (!subPath || subPath === '') {
      subPath = '/';
    }

    // Check Auth
    if (config.dashboard.auth.enabled) {
      const isAuthorized = verifyDashboardAuth(config.dashboard.auth, req.headers, query);
      if (!isAuthorized) {
        res.setHeader('WWW-Authenticate', 'Basic realm="API Trace Studio"');
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Authentication required' }));
        return;
      }
    }

    const logger = getLogger();
    const queryEngine = logger.getQueryEngine();

    // API Route: /api/stats
    if (subPath === '/api/stats') {
      const stats = queryEngine.getStats();
      const responseData = {
        ...stats,
        serviceName: config.serviceName,
        environment: config.environment,
        title: customOptions?.title || config.dashboard.title,
      };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(responseData));
      return;
    }

    // API Route: /api/logs
    if (subPath === '/api/logs') {
      const queryParams: LogQueryParams = {
        page: query.page ? parseInt(query.page, 10) : 1,
        limit: query.limit ? parseInt(query.limit, 10) : 25,
        search: query.search,
        level: query.level,
        status: query.status,
        method: query.method,
        isSlow: query.isSlow === 'true' ? true : query.isSlow === 'false' ? false : undefined,
        isError: query.isError === 'true' ? true : query.isError === 'false' ? false : undefined,
        route: query.route,
        traceId: query.traceId,
        requestId: query.requestId,
        startDate: query.startDate,
        endDate: query.endDate,
        sortBy: query.sortBy as any,
        sortOrder: query.sortOrder as any,
      };

      const result = queryEngine.queryMemory(queryParams);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return;
    }

    // API Route: /api/stream (SSE)
    if (subPath === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': stream connected\n\n');

      const ringBuffer = logger.getRingBuffer();
      const unsubscribe = ringBuffer.subscribe((record) => {
        try {
          res.write(`data: ${JSON.stringify(record)}\n\n`);
        } catch {
          // ignore
        }
      });

      // Keepalive heartbeat
      const keepAlive = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          // ignore
        }
      }, 15000);

      req.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });

      return;
    }

    // API Route: /api/export
    if (subPath === '/api/export') {
      const format = query.format || 'json';
      const allRecords = logger.getRingBuffer().toReversedArray();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      if (format === 'csv') {
        const csv = convertLogsToCsv(allRecords);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="api-trace-${timestamp}.csv"`);
        res.statusCode = 200;
        res.end(csv);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="api-trace-${timestamp}.json"`);
        res.statusCode = 200;
        res.end(JSON.stringify(allRecords, null, 2));
      }
      return;
    }

    // API Route: /api/health
    if (subPath === '/api/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // Static Assets Serving
    let assetName = subPath === '/' ? 'index.html' : subPath.replace(/^\/+/, '');
    if (assetName === '' || assetName === 'index') {
      assetName = 'index.html';
    }

    const safePath = safeResolvePath(publicDir, assetName);
    if (!safePath || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
      if (typeof next === 'function') return next();
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    };

    // When serving HTML, inject <base href="..."> so that relative assets (style.css, app.js)
    // resolve to /logs/style.css even if the user opens /logs without a trailing slash!
    if (ext === '.html') {
      const rawPath = (req.baseUrl || req.originalUrl || req.url || config.dashboard.endpoint || '/logs').split('?')[0];
      let mountPath = rawPath.endsWith('/') ? rawPath : rawPath + '/';
      if (mountPath.endsWith('/index.html/')) {
        mountPath = mountPath.slice(0, -11) + '/';
      }
      let html = fs.readFileSync(safePath, 'utf-8');
      if (!html.includes('<base ')) {
        html = html.replace('<head>', `<head>\n  <base href="${mountPath}">`);
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypes[ext] || 'text/plain');
    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
  };
}
