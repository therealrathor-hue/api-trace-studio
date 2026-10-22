import { RedactionConfig } from '../config/types';

// Regular expressions for sensitive string values
const JWT_REGEX = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g;
const BEARER_AUTH_REGEX = /Bearer\s+[a-zA-Z0-9_\-\.]+/gi;
const CREDIT_CARD_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

export class Redactor {
  private config: RedactionConfig;
  private keySet: Set<string>;
  private headerSet: Set<string>;

  constructor(config: RedactionConfig) {
    this.config = config;
    this.keySet = new Set(config.keys.map((k) => k.toLowerCase()));
    this.headerSet = new Set(config.maskHeaders.map((h) => h.toLowerCase()));
  }

  public updateConfig(config: RedactionConfig): void {
    this.config = config;
    this.keySet = new Set(config.keys.map((k) => k.toLowerCase()));
    this.headerSet = new Set(config.maskHeaders.map((h) => h.toLowerCase()));
  }

  public isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    if (this.keySet.has(lowerKey)) return true;
    for (const pattern of this.keySet) {
      if (lowerKey.includes(pattern)) return true;
    }
    return false;
  }

  public maskStringPatterns(str: string): string {
    if (!this.config.maskPatterns || typeof str !== 'string') return str;

    let result = str;
    if (BEARER_AUTH_REGEX.test(result)) {
      result = result.replace(BEARER_AUTH_REGEX, 'Bearer ' + this.config.replacement);
    }
    if (JWT_REGEX.test(result)) {
      result = result.replace(JWT_REGEX, '[REDACTED_JWT]');
    }
    if (CREDIT_CARD_REGEX.test(result)) {
      result = result.replace(CREDIT_CARD_REGEX, '[REDACTED_CARD]');
    }
    if (SSN_REGEX.test(result)) {
      result = result.replace(SSN_REGEX, '[REDACTED_SSN]');
    }
    return result;
  }

  public redactHeaders(headers: Record<string, any> | undefined): Record<string, any> {
    if (!headers || !this.config.enabled) return headers || {};
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (this.headerSet.has(lowerKey) || this.isSensitiveKey(key)) {
        result[key] = this.config.replacement;
      } else if (typeof value === 'string') {
        result[key] = this.maskStringPatterns(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  public redact(data: unknown, seen = new WeakSet<object>()): unknown {
    if (!this.config.enabled) return data;
    if (data === null || data === undefined) return data;

    // Primitives
    if (typeof data === 'string') {
      return this.maskStringPatterns(data);
    }
    if (typeof data !== 'object') {
      return data;
    }

    // Circular reference guard
    if (seen.has(data as object)) {
      return '[Circular]';
    }
    seen.add(data as object);

    // Arrays
    if (Array.isArray(data)) {
      return data.map((item) => this.redact(item, seen));
    }

    // Buffers / Date / RegExp / Error
    if (Buffer.isBuffer(data)) {
      return `[Buffer ${data.length} bytes]`;
    }
    if (data instanceof Date) {
      return data.toISOString();
    }
    if (data instanceof RegExp) {
      return data.toString();
    }
    if (data instanceof Error) {
      return {
        name: data.name,
        message: this.maskStringPatterns(data.message),
        stack: this.maskStringPatterns(data.stack || ''),
        ...(data as any),
      };
    }

    // Plain objects
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (this.config.customRedactor) {
        const custom = this.config.customRedactor(key, value);
        if (custom !== undefined) {
          result[key] = custom;
          continue;
        }
      }

      if (this.isSensitiveKey(key)) {
        result[key] = this.config.replacement;
      } else {
        result[key] = this.redact(value, seen);
      }
    }

    return result;
  }
}
