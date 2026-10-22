import * as fs from 'fs';
import * as path from 'path';
import { getConfig, loadConfigFile } from '../config';
import { Redactor } from '../security/redactor';

export function runValidate(customConfigFile?: string): boolean {
  console.log('🔍 Validating API Trace Studio Configuration...\n');
  let hasErrors = false;
  let hasWarnings = false;

  const config = getConfig();

  // 1. Config file check
  const fileConfig = loadConfigFile(customConfigFile);
  if (Object.keys(fileConfig).length === 0) {
    console.log('ℹ  No configuration file found; using default & environment settings.');
  } else {
    console.log('✔ Configuration file successfully loaded and parsed.');
  }

  // 2. Storage Directory Check
  const storageDir = path.resolve(process.cwd(), config.storage.directory);
  try {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    const testFile = path.join(storageDir, `.test_write_${Date.now()}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log(`✔ Storage directory "${storageDir}" is writable.`);
  } catch (err) {
    console.error(`✖ Storage directory "${storageDir}" write test failed: ${(err as Error).message}`);
    hasErrors = true;
  }

  // 3. Redaction Check
  if (!config.redaction.enabled) {
    console.warn('⚠️  Warning: Redaction is currently disabled. Sensitive data might be logged.');
    hasWarnings = true;
  } else {
    const redactor = new Redactor(config.redaction);
    const testObj = { password: 'secret123', safe: 'hello' };
    const redacted = redactor.redact(testObj) as any;
    if (redacted.password === config.redaction.replacement && redacted.safe === 'hello') {
      console.log('✔ Redaction engine verified: sensitive fields correctly masked.');
    } else {
      console.error('✖ Redaction engine failed verification test.');
      hasErrors = true;
    }
  }

  // 4. Dashboard Auth Check
  if (config.dashboard.enabled) {
    if (config.environment === 'production' && !config.dashboard.auth.enabled) {
      console.warn('⚠️  Warning: Dashboard is enabled in production without authentication!');
      hasWarnings = true;
    } else if (config.dashboard.auth.enabled) {
      if (!config.dashboard.auth.password && !config.dashboard.auth.token) {
        console.error('✖ Dashboard auth is enabled, but neither password nor token is set.');
        hasErrors = true;
      } else {
        console.log('✔ Dashboard authentication properly configured.');
      }
    } else {
      console.log('ℹ  Dashboard enabled (development mode, auth disabled).');
    }
  }

  // 5. Performance Thresholds
  if (config.performance.slowApiThresholdMs < 50) {
    console.warn(`⚠️  Warning: slowApiThresholdMs is very low (${config.performance.slowApiThresholdMs}ms). Many APIs may be flagged.`);
    hasWarnings = true;
  } else {
    console.log(`✔ Performance slowApiThreshold set to ${config.performance.slowApiThresholdMs}ms.`);
  }

  console.log('');
  if (hasErrors) {
    console.error('❌ Validation failed with errors.');
    return false;
  } else if (hasWarnings) {
    console.log('⚠️  Validation passed with warnings.');
    return true;
  } else {
    console.log('✅ All checks passed successfully!');
    return true;
  }
}
