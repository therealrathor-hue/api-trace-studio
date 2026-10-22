import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Redactor } from '../../src/security/redactor';
import { DEFAULT_CONFIG } from '../../src/config/defaults';

describe('Redactor Module', () => {
  const redactor = new Redactor(DEFAULT_CONFIG.redaction);

  it('should redact sensitive keys in plain objects', () => {
    const input = {
      username: 'alice',
      password: 'mypassword123',
      apiKey: 'key_live_998877',
      secret_token: 'secret_val',
      metadata: {
        role: 'admin',
        creditCard: '1234-5678-9012-3456',
      },
    };

    const output = redactor.redact(input) as any;

    assert.equal(output.username, 'alice');
    assert.equal(output.password, '[REDACTED]');
    assert.equal(output.apiKey, '[REDACTED]');
    assert.equal(output.secret_token, '[REDACTED]');
    assert.equal(output.metadata.role, 'admin');
    assert.equal(output.metadata.creditCard, '[REDACTED]');
  });

  it('should redact case-insensitively and match substring patterns', () => {
    const input = {
      PASSWORD: 'upper',
      user_password_hash: 'hash123',
      clientSecret: 'secret_abc',
    };

    const output = redactor.redact(input) as any;
    assert.equal(output.PASSWORD, '[REDACTED]');
    assert.equal(output.user_password_hash, '[REDACTED]');
    assert.equal(output.clientSecret, '[REDACTED]');
  });

  it('should redact sensitive items in arrays and nested structures', () => {
    const input = [
      { id: 1, token: 'token1' },
      { id: 2, token: 'token2', nested: [{ pass: 'secret' }] },
    ];

    const output = redactor.redact(input) as any;
    assert.equal(output[0].id, 1);
    assert.equal(output[0].token, '[REDACTED]');
    assert.equal(output[1].token, '[REDACTED]');
    assert.equal(output[1].nested[0].pass, '[REDACTED]');
  });

  it('should handle circular references safely without infinite recursion', () => {
    const circular: any = { name: 'test' };
    circular.self = circular;

    const output = redactor.redact(circular) as any;
    assert.equal(output.name, 'test');
    assert.equal(output.self, '[Circular]');
  });

  it('should mask sensitive patterns inside string values', () => {
    const bearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
    const maskedBearer = redactor.maskStringPatterns(bearer);
    assert.ok(maskedBearer.includes('Bearer [REDACTED]') || maskedBearer.includes('[REDACTED_JWT]'));

    const cc = 'Customer card is 4111-2222-3333-4444 on file';
    const maskedCC = redactor.maskStringPatterns(cc);
    assert.ok(maskedCC.includes('[REDACTED_CARD]'));

    const ssn = 'SSN: 000-12-3456';
    const maskedSSN = redactor.maskStringPatterns(ssn);
    assert.ok(maskedSSN.includes('[REDACTED_SSN]'));
  });

  it('should redact specified headers correctly', () => {
    const headers = {
      authorization: 'Bearer secret_token_xyz',
      cookie: 'sessionId=abc123; tracking=true',
      'x-api-key': 'key_12345',
      'content-type': 'application/json',
      accept: '*/*',
    };

    const redacted = redactor.redactHeaders(headers);
    assert.equal(redacted['authorization'], '[REDACTED]');
    assert.equal(redacted['cookie'], '[REDACTED]');
    assert.equal(redacted['x-api-key'], '[REDACTED]');
    assert.equal(redacted['content-type'], 'application/json');
    assert.equal(redacted['accept'], '*/*');
  });

  it('should support custom redactor hook', () => {
    const custom = new Redactor({
      ...DEFAULT_CONFIG.redaction,
      customRedactor: (key, val) => {
        if (key === 'email') return 'masked-email@domain.com';
        return undefined;
      },
    });

    const output = custom.redact({ email: 'user@real.com', other: 'val' }) as any;
    assert.equal(output.email, 'masked-email@domain.com');
    assert.equal(output.other, 'val');
  });
});
