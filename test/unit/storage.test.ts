import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { RingBuffer } from '../../src/storage/ring-buffer';
import { FileWriter } from '../../src/storage/file-writer';
import { LogRecord } from '../../src/storage/types';

describe('Storage Module', () => {
  describe('RingBuffer', () => {
    it('should push and maintain FIFO circular buffer within capacity', () => {
      const ring = new RingBuffer(3);
      assert.equal(ring.size(), 0);

      const makeRecord = (id: string): LogRecord => ({
        id,
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'test',
        env: 'test',
        type: 'app_log',
        traceId: 'tr-' + id,
        requestId: 'req-' + id,
      });

      ring.push(makeRecord('1'));
      ring.push(makeRecord('2'));
      ring.push(makeRecord('3'));
      assert.equal(ring.size(), 3);

      let arr = ring.toArray();
      assert.deepEqual(arr.map((r) => r.id), ['1', '2', '3']);

      // Push 4th: should overwrite oldest ('1')
      ring.push(makeRecord('4'));
      assert.equal(ring.size(), 3);

      arr = ring.toArray();
      assert.deepEqual(arr.map((r) => r.id), ['2', '3', '4']);

      // Reverse array: newest first
      const rev = ring.toReversedArray();
      assert.deepEqual(rev.map((r) => r.id), ['4', '3', '2']);
    });

    it('should notify live subscribers when new record arrives', () => {
      const ring = new RingBuffer(10);
      const received: string[] = [];

      const unsub = ring.subscribe((rec) => {
        received.push(rec.id);
      });

      ring.push({ id: 'rec-1' } as any);
      ring.push({ id: 'rec-2' } as any);
      assert.deepEqual(received, ['rec-1', 'rec-2']);

      unsub();
      ring.push({ id: 'rec-3' } as any);
      assert.deepEqual(received, ['rec-1', 'rec-2']); // no more after unsub
    });
  });

  describe('FileWriter', () => {
    const testDir = path.resolve(process.cwd(), 'tmp-test-logs');

    beforeEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should write logs asynchronously and flush synchronously', async () => {
      const writer = new FileWriter({
        type: 'file',
        directory: 'tmp-test-logs',
        filename: 'test.log',
        maxSizeBytes: 1024 * 1024,
        maxFiles: 5,
        compress: false,
        inMemoryBufferSize: 100,
        flushIntervalMs: 50,
      });

      const rec: LogRecord = {
        id: 'test-1',
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'test-svc',
        env: 'test',
        type: 'http_request',
        traceId: 'tr-1',
        requestId: 'req-1',
        method: 'GET',
        url: '/test',
        statusCode: 200,
        durationMs: 15.5,
      };

      writer.write(rec);
      await writer.flush();

      const logFile = path.join(testDir, 'test.log');
      assert.ok(fs.existsSync(logFile));
      const content = fs.readFileSync(logFile, 'utf-8');
      assert.ok(content.includes('"id":"test-1"'));
      assert.ok(content.includes('"url":"/test"'));

      await writer.close();
    });

    it('should rotate file when exceeding maxSizeBytes', async () => {
      const writer = new FileWriter({
        type: 'file',
        directory: 'tmp-test-logs',
        filename: 'rotate.log',
        maxSizeBytes: 200, // tiny limit to trigger rotation
        maxFiles: 3,
        compress: false,
        inMemoryBufferSize: 100,
        flushIntervalMs: 50,
      });

      // Write records with flushes to trigger rotation and keep multiple files
      for (let i = 0; i < 5; i++) {
        writer.write({
          id: 'rec-' + i,
          timestamp: new Date().toISOString(),
          level: 'info',
          service: 'test',
          env: 'test',
          type: 'app_log',
          traceId: 't',
          requestId: 'r',
          message: 'Some long descriptive text that takes up bytes in the file to exceed threshold ' + i,
        });
        await writer.flush();
      }

      await writer.close();

      const files = writer.getLogFiles();
      assert.ok(files.length >= 2, `Should have rotated log files, got ${files.length}`);
    });
  });
});
