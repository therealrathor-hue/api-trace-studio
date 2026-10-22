import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { runCli } from '../../src/cli';

describe('CLI Commands', () => {
  it('should print help without throwing', async () => {
    let output = '';
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      output += args.join(' ') + '\n';
    };

    try {
      await runCli(['help']);
      assert.ok(output.includes('USAGE:'));
      assert.ok(output.includes('api-trace-studio <command>'));
      assert.ok(output.includes('init'));
      assert.ok(output.includes('validate'));
      assert.ok(output.includes('doctor'));
      assert.ok(output.includes('dashboard'));
    } finally {
      console.log = originalLog;
    }
  });

  it('should print version without throwing', async () => {
    let output = '';
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      output += args.join(' ') + '\n';
    };

    try {
      await runCli(['--version']);
      assert.ok(output.includes('api-trace-studio v'));
    } finally {
      console.log = originalLog;
    }
  });

  it('should run doctor diagnostics command', async () => {
    let output = '';
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      output += args.join(' ') + '\n';
    };

    try {
      await runCli(['doctor']);
      assert.ok(output.includes('Doctor & Diagnostics'));
      assert.ok(output.includes('Node.js:'));
      assert.ok(output.includes('Platform:'));
    } finally {
      console.log = originalLog;
    }
  });

  it('should run validate command', async () => {
    let output = '';
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      output += args.join(' ') + '\n';
    };

    try {
      await runCli(['validate']);
      assert.ok(output.includes('Validating API Trace Studio Configuration'));
    } finally {
      console.log = originalLog;
    }
  });
});
