import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config';

export function runClean(options: { all?: boolean; olderThanDays?: number } = {}): void {
  const config = getConfig();
  const storageDir = path.resolve(process.cwd(), config.storage.directory);

  if (!fs.existsSync(storageDir)) {
    console.log(`Log directory "${storageDir}" does not exist. Nothing to clean.`);
    return;
  }

  const files = fs.readdirSync(storageDir);
  const baseName = config.storage.filename;
  let deletedCount = 0;
  let freedBytes = 0;

  const thresholdMs = options.olderThanDays ? Date.now() - options.olderThanDays * 86400000 : 0;

  for (const f of files) {
    if (f === baseName || f.startsWith(baseName + '.')) {
      const filePath = path.join(storageDir, f);
      const stat = fs.statSync(filePath);

      const shouldDelete =
        options.all ||
        (options.olderThanDays ? stat.mtimeMs < thresholdMs : f !== baseName); // default cleans rotated files

      if (shouldDelete) {
        try {
          freedBytes += stat.size;
          fs.unlinkSync(filePath);
          deletedCount++;
        } catch (err) {
          console.warn(`Failed to delete ${f}:`, (err as Error).message);
        }
      }
    }
  }

  console.log(`✔ Cleaned ${deletedCount} log file(s), freed ${Math.round(freedBytes / 1024)} KB.`);
}
