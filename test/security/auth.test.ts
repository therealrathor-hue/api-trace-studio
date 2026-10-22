import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { timingSafeCompare, parseBasicAuthHeader, verifyDashboardAuth } from '../../src/security/auth';

describe('Security: Authentication & Timing Attack Protection', () => {
  it('should compare strings in constant time', () => {
    assert.equal(timingSafeCompare('admin_password_123', 'admin_password_123'), true);
    assert.equal(timingSafeCompare('admin_password_123', 'admin_password_456'), false);
    assert.equal(timingSafeCompare('short', 'longer_string_here'), false);
    assert.equal(timingSafeCompare('', ''), true);
  });

  it('should parse HTTP Basic Auth headers correctly', () => {
    const validHeader = 'Basic ' + Buffer.from('myuser:mypassword').toString('base64');
    const parsed = parseBasicAuthHeader(validHeader);

    assert.ok(parsed);
    assert.equal(parsed.username, 'myuser');
    assert.equal(parsed.password, 'mypassword');

    assert.equal(parseBasicAuthHeader(undefined), null);
    assert.equal(parseBasicAuthHeader('Bearer xyz'), null);
    assert.equal(parseBasicAuthHeader('Basic ' + Buffer.from('no-colon').toString('base64')), null);
  });

  it('should verify dashboard authentication via Basic auth or Bearer token', () => {
    const authConfig = {
      enabled: true,
      username: 'admin',
      password: 'secret_password_123',
      token: 'secure_api_trace_token_999',
    };

    // Disabled auth returns true
    assert.equal(verifyDashboardAuth({ enabled: false }, {}), true);

    // Basic Auth
    const basicHeader = 'Basic ' + Buffer.from('admin:secret_password_123').toString('base64');
    assert.equal(verifyDashboardAuth(authConfig, { authorization: basicHeader }), true);

    const wrongBasicHeader = 'Basic ' + Buffer.from('admin:wrong_password').toString('base64');
    assert.equal(verifyDashboardAuth(authConfig, { authorization: wrongBasicHeader }), false);

    // Bearer Token
    assert.equal(
      verifyDashboardAuth(authConfig, { authorization: 'Bearer secure_api_trace_token_999' }),
      true
    );
    assert.equal(
      verifyDashboardAuth(authConfig, { authorization: 'Bearer wrong_token' }),
      false
    );

    // Custom Token Header
    assert.equal(
      verifyDashboardAuth(authConfig, { 'x-api-trace-token': 'secure_api_trace_token_999' }),
      true
    );

    // Query Token
    assert.equal(
      verifyDashboardAuth(authConfig, {}, { token: 'secure_api_trace_token_999' }),
      true
    );
  });
});
