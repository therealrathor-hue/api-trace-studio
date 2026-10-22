import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DEFAULT_CONFIG, getConfig, initConfig, resetConfig, setConfig, deepMerge } from '../../src/config';

describe('Config Module', () => {
  beforeEach(() => {
    resetConfig();
    delete process.env.API_TRACE_SERVICE_NAME;
    delete process.env.API_TRACE_LOG_LEVEL;
    delete process.env.API_TRACE_STORAGE_DIR;
    delete process.env.API_TRACE_SLOW_API_THRESHOLD_MS;
  });

  it('should return default config when not customized', () => {
    const config = getConfig();
    assert.ok(config);
    assert.equal(config.logLevel, 'info');
    assert.equal(config.storage.type, 'both');
    assert.equal(config.storage.directory, './logs');
    assert.equal(config.dashboard.endpoint, '/logs');
    assert.equal(config.performance.slowApiThresholdMs, 1000);
    assert.equal(config.redaction.enabled, true);
  });

  it('should deep merge custom programmatic options', () => {
    const config = initConfig({
      serviceName: 'custom-service',
      performance: {
        slowApiThresholdMs: 500,
      },
      dashboard: {
        endpoint: '/admin/logs/',
      },
    });

    assert.equal(config.serviceName, 'custom-service');
    assert.equal(config.performance.slowApiThresholdMs, 500);
    // Should preserve untouched sibling properties
    assert.equal(config.performance.slowFunctionThresholdMs, 200);
    // Should normalize dashboard endpoint
    assert.equal(config.dashboard.endpoint, '/admin/logs');
  });

  it('should load environment variables correctly', () => {
    process.env.API_TRACE_SERVICE_NAME = 'env-service';
    process.env.API_TRACE_LOG_LEVEL = 'debug';
    process.env.API_TRACE_SLOW_API_THRESHOLD_MS = '250';
    process.env.API_TRACE_STORAGE_DIR = './custom-logs';

    const config = initConfig();
    assert.equal(config.serviceName, 'env-service');
    assert.equal(config.logLevel, 'debug');
    assert.equal(config.performance.slowApiThresholdMs, 250);
    assert.equal(config.storage.directory, './custom-logs');
  });

  it('should allow dynamic update via setConfig', () => {
    initConfig();
    const updated = setConfig({
      logLevel: 'warn',
      dashboard: {
        title: 'My Custom APM',
      },
    });

    assert.equal(updated.logLevel, 'warn');
    assert.equal(updated.dashboard.title, 'My Custom APM');
    assert.equal(getConfig().logLevel, 'warn');
  });

  it('should correctly deep merge nested objects without mutating source', () => {
    const target = { a: 1, nested: { b: 2, c: 3 } };
    const source = { nested: { c: 99, d: 4 } };
    const result = deepMerge(target, source);

    assert.equal(result.a, 1);
    assert.equal(result.nested.b, 2);
    assert.equal(result.nested.c, 99);
    assert.equal(result.nested.d, 4);
    assert.equal(target.nested.c, 3, 'Target should not be mutated in place');
  });
});
