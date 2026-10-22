import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import express from 'express';
import request from 'supertest';
import { safeResolvePath } from '../../src/security/sanitizer';
import { dashboardMiddleware } from '../../src/dashboard/router';
import { initApiTrace, resetConfig } from '../../src';

describe('Security: Path Traversal Protection', () => {
  const baseDir = path.resolve(__dirname, '../../public');

  it('should allow valid files within the base directory', () => {
    const safe = safeResolvePath(baseDir, 'index.html');
    assert.ok(safe);
    assert.equal(safe, path.join(baseDir, 'index.html'));
  });

  it('should reject parent directory traversal attempts (..)', () => {
    const malicious = safeResolvePath(baseDir, '../../../../etc/passwd');
    assert.equal(malicious, null);

    const relativeEscape = safeResolvePath(baseDir, '../src/index.ts');
    assert.equal(relativeEscape, null);
  });

  it('should reject absolute paths pointing outside base directory', () => {
    const malicious = safeResolvePath(baseDir, '/etc/passwd');
    assert.equal(malicious, null);
  });

  it('should reject dashboard HTTP requests with path traversal payloads', async () => {
    resetConfig();
    initApiTrace({
      serviceName: 'security-app',
      dashboard: { enabled: true, endpoint: '/logs' },
    });

    const app = express();
    app.use('/logs', dashboardMiddleware());

    // Path traversal requests should return 404 Not Found
    await request(app).get('/logs/..%2f..%2fpackage.json').expect(404);
    await request(app).get('/logs/../../package.json').expect(404);
    await request(app).get('/logs/%2e%2e%2f%2e%2e%2fetc%2fpasswd').expect(404);
  });
});
