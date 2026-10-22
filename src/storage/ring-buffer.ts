import { LogRecord } from './types';

export type RingBufferSubscriber = (record: LogRecord) => void;

export class RingBuffer {
  private buffer: Array<LogRecord | null>;
  private capacity: number;
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;
  private subscribers: Set<RingBufferSubscriber> = new Set();

  constructor(capacity: number = 2000) {
    this.capacity = Math.max(1, capacity);
    this.buffer = new Array(this.capacity).fill(null);
  }

  public push(record: LogRecord): void {
    this.buffer[this.tail] = record;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }

    // Notify live subscribers
    if (this.subscribers.size > 0) {
      for (const sub of this.subscribers) {
        try {
          sub(record);
        } catch {
          // ignore subscriber error
        }
      }
    }
  }

  public size(): number {
    return this.count;
  }

  public getCapacity(): number {
    return this.capacity;
  }

  /**
   * Returns records in chronological order (oldest first).
   */
  public toArray(): LogRecord[] {
    const result: LogRecord[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      result[i] = this.buffer[idx]!;
    }
    return result;
  }

  /**
   * Returns records in reverse chronological order (newest first).
   */
  public toReversedArray(): LogRecord[] {
    const result: LogRecord[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const idx = (this.tail - 1 - i + this.capacity) % this.capacity;
      result[i] = this.buffer[idx]!;
    }
    return result;
  }

  public subscribe(sub: RingBufferSubscriber): () => void {
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  public clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
