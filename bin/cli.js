#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Try compiled dist/ first, otherwise src/ via tsx if running in development
const distPath = path.resolve(__dirname, '../dist/cli/index.js');

if (fs.existsSync(distPath)) {
  const { runCli } = require(distPath);
  runCli().catch((err) => {
    console.error('[api-trace-studio] CLI Error:', err);
    process.exit(1);
  });
} else {
  // Try tsx registration for development
  try {
    require('tsx');
    const { runCli } = require('../src/cli/index.ts');
    runCli().catch((err) => {
      console.error('[api-trace-studio] CLI Error:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('[api-trace-studio] Error: Package must be built first. Run: npm run build');
    process.exit(1);
  }
}
