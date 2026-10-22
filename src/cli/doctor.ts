import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config';

export function runDoctor(): void {
  const config = getConfig();
  const mem = process.memoryUsage();

  console.log('🩺 API Trace Studio Doctor & Diagnostics');
  console.log('========================================\n');

  console.log('System Information:');
  console.log(`  • Node.js:     ${process.version}`);
  console.log(`  • Platform:    ${process.platform} (${os.release()})`);
  console.log(`  • Architecture:${process.arch}`);
  console.log(`  • Process PID: ${process.pid}`);
  console.log(`  • Memory RSS:  ${Math.round(mem.rss / 1024 / 1024)} MB`);
  console.log(`  • Heap Used:   ${Math.round(mem.heapUsed / 1024 / 1024)} MB / ${Math.round(mem.heapTotal / 1024 / 1024)} MB`);
  console.log(`  • CPU Cores:   ${os.cpus().length}`);

  console.log('\nService Configuration:');
  console.log(`  • Service:     ${config.serviceName}`);
  console.log(`  • Environment: ${config.environment}`);
  console.log(`  • Log Level:   ${config.logLevel}`);
  console.log(`  • Dashboard:   ${config.dashboard.enabled ? `Enabled at ${config.dashboard.endpoint}` : 'Disabled'}`);
  console.log(`  • Auth:        ${config.dashboard.auth.enabled ? 'Enabled' : 'Disabled'}`);

  console.log('\nStorage Status:');
  const storageDir = path.resolve(process.cwd(), config.storage.directory);
  console.log(`  • Type:        ${config.storage.type}`);
  console.log(`  • Directory:   ${storageDir}`);

  if (fs.existsSync(storageDir)) {
    try {
      const files = fs.readdirSync(storageDir);
      let totalBytes = 0;
      for (const f of files) {
        const stat = fs.statSync(path.join(storageDir, f));
        if (stat.isFile()) totalBytes += stat.size;
      }
      console.log(`  • Files:       ${files.length} log file(s)`);
      console.log(`  • Total Size:  ${Math.round(totalBytes / 1024)} KB (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
    } catch {
      console.log('  • Files:       (Unable to read directory)');
    }
  } else {
    console.log('  • Status:      Directory not created yet (will create on first log)');
  }

  console.log('\nTracing & Instrumentation:');
  console.log(`  • Tracing:     ${config.tracing.enabled ? 'Active' : 'Disabled'}`);
  console.log(`  • Outbound:    HTTP=${config.outbound.http}, Fetch=${config.outbound.fetch}`);
  console.log(`  • Database:    Mongoose=${config.database.mongoose}`);
  console.log(`  • Redaction:   ${config.redaction.enabled ? `${config.redaction.keys.length} sensitive keys configured` : 'Disabled'}`);
  console.log(`  • Sampling:    Rate=${config.sampling.rate * 100}% (Errors Always=${config.sampling.alwaysSampleErrors})`);

  console.log('\nDoctor diagnostics completed.\n');
}
