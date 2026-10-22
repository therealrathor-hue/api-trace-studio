import * as fs from 'fs';
import * as path from 'path';
import { StorageConfig } from '../config/types';
import { LogRecord } from './types';

export class FileWriter {
  private config: StorageConfig;
  private logDir: string;
  private currentFilePath: string;
  private writeQueue: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private isClosed = false;
  private currentSizeBytes = 0;

  constructor(config: StorageConfig) {
    this.config = config;
    this.logDir = path.resolve(process.cwd(), config.directory);
    this.currentFilePath = path.join(this.logDir, config.filename);

    this.initDirectory();
    this.initFileStats();
    this.startFlushTimer();
  }

  private initDirectory(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.error('[api-trace-studio] Error creating log directory:', (err as Error).message);
    }
  }

  private initFileStats(): void {
    try {
      if (fs.existsSync(this.currentFilePath)) {
        const stat = fs.statSync(this.currentFilePath);
        this.currentSizeBytes = stat.size;
      } else {
        this.currentSizeBytes = 0;
      }
    } catch {
      this.currentSizeBytes = 0;
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, Math.max(100, this.config.flushIntervalMs));
    if (this.flushTimer.unref) {
      this.flushTimer.unref(); // Don't keep event loop alive solely for log flusher
    }
  }

  public write(record: LogRecord): void {
    if (this.isClosed) return;

    try {
      const line = JSON.stringify(record) + '\n';
      this.writeQueue.push(line);

      // If queue exceeds 100 entries, trigger flush immediately
      if (this.writeQueue.length >= 100) {
        this.flush().catch(() => {});
      }
    } catch (err) {
      // Never throw from logger
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.writeQueue.length === 0) return;
    this.isFlushing = true;

    const toWrite = this.writeQueue;
    this.writeQueue = [];

    try {
      this.rotateIfNeeded();
      const content = toWrite.join('');
      await fs.promises.appendFile(this.currentFilePath, content, 'utf-8');
      this.currentSizeBytes += Buffer.byteLength(content, 'utf-8');
      this.rotateIfNeeded();
    } catch (err) {
      // Put records back in queue if write failed (up to safe limit)
      if (this.writeQueue.length < 1000) {
        this.writeQueue = toWrite.concat(this.writeQueue);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  public flushSync(): void {
    if (this.writeQueue.length === 0) return;
    const toWrite = this.writeQueue;
    this.writeQueue = [];

    try {
      this.rotateIfNeeded();
      const content = toWrite.join('');
      fs.appendFileSync(this.currentFilePath, content, 'utf-8');
      this.currentSizeBytes += Buffer.byteLength(content, 'utf-8');
    } catch {
      // ignore
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (this.currentSizeBytes < this.config.maxSizeBytes) {
        return;
      }

      // Check max files and shift older files
      const baseName = this.config.filename;
      const maxFiles = Math.max(1, this.config.maxFiles);

      // Remove oldest file if exceeds maxFiles
      const oldestFile = path.join(this.logDir, `${baseName}.${maxFiles}`);
      if (fs.existsSync(oldestFile)) {
        try {
          fs.unlinkSync(oldestFile);
        } catch {
          // ignore
        }
      }

      // Shift existing rotated files
      for (let i = maxFiles - 1; i >= 1; i--) {
        const src = path.join(this.logDir, `${baseName}.${i}`);
        const dst = path.join(this.logDir, `${baseName}.${i + 1}`);
        if (fs.existsSync(src)) {
          try {
            fs.renameSync(src, dst);
          } catch {
            // ignore
          }
        }
      }

      // Rotate current active file to .1
      if (fs.existsSync(this.currentFilePath)) {
        try {
          fs.renameSync(this.currentFilePath, path.join(this.logDir, `${baseName}.1`));
        } catch {
          // ignore
        }
      }

      this.currentSizeBytes = 0;
    } catch (err) {
      // Rotation failure shouldn't crash app
    }
  }

  public async close(): Promise<void> {
    this.isClosed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  public getLogDirectory(): string {
    return this.logDir;
  }

  public getCurrentFilePath(): string {
    return this.currentFilePath;
  }

  public getLogFiles(): string[] {
    try {
      if (!fs.existsSync(this.logDir)) return [];
      const files = fs.readdirSync(this.logDir);
      const baseName = this.config.filename;
      return files
        .filter((f) => f === baseName || f.startsWith(baseName + '.'))
        .map((f) => path.join(this.logDir, f));
    } catch {
      return [];
    }
  }
}
