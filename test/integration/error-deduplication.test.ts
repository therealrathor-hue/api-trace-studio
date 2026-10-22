import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { isDuplicateError, computeErrorFingerprint, serializeError } from '../../src/errors';

describe('Error Monitoring & Deduplication', () => {
  it('should serialize Error objects cleanly', () => {
    const err = new Error('Custom failure message');
    (err as any).code = 'ERR_CUSTOM';
    (err as any).statusCode = 502;

    const serialized = serializeError(err);
    assert.equal(serialized.name, 'Error');
    assert.equal(serialized.message, 'Custom failure message');
    assert.equal(serialized.code, 'ERR_CUSTOM');
    assert.equal(serialized.statusCode, 502);
    assert.ok(serialized.stack);
  });

  it('should compute consistent fingerprint for identical errors', () => {
    function throwSampleError() {
      return new Error('Timeout on service call');
    }

    const err1 = throwSampleError();
    const err2 = throwSampleError();

    const fp1 = computeErrorFingerprint(err1);
    const fp2 = computeErrorFingerprint(err2);

    assert.equal(fp1, fp2);
  });

  it('should detect duplicate errors occurring within the deduplication window', () => {
    const err = new Error('Database deadlock occurred');

    const firstSeen = isDuplicateError(err, 500);
    assert.equal(firstSeen, false, 'First occurrence should not be a duplicate');

    const secondSeen = isDuplicateError(err, 500);
    assert.equal(secondSeen, true, 'Immediate subsequent occurrence should be flagged as duplicate');
  });
});
