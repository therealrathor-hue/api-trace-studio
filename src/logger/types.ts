import { LogLevel } from '../config/types';

export const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function shouldLogLevel(configuredLevel: LogLevel, recordLevel: LogLevel): boolean {
  return LOG_LEVEL_SEVERITY[recordLevel] >= LOG_LEVEL_SEVERITY[configuredLevel];
}
