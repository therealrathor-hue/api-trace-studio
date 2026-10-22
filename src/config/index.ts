import * as fs from 'fs';
import * as path from 'path';
import { ApiTraceConfig, ApiTraceUserConfig, DeepPartial, LogLevel } from './types';
import { DEFAULT_CONFIG } from './defaults';

let activeConfig: ApiTraceConfig = { ...DEFAULT_CONFIG };
let isInitialized = false;

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

export function deepMerge<T extends Record<string, any>>(target: T, source?: Record<string, any>): T {
  if (!source) return target;
  const output = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = output[key];

    if (sourceVal === undefined) continue;

    if (isObject(targetVal) && isObject(sourceVal)) {
      output[key as keyof T] = deepMerge(targetVal, sourceVal) as any;
    } else {
      output[key as keyof T] = sourceVal;
    }
  }

  return output;
}

export function loadConfigFile(customPath?: string): ApiTraceUserConfig {
  const rootDir = process.cwd();
  const candidateFiles = customPath
    ? [path.resolve(rootDir, customPath)]
    : [
        path.resolve(rootDir, 'api-trace.config.js'),
        path.resolve(rootDir, 'api-trace.config.cjs'),
        path.resolve(rootDir, 'api-trace.config.json'),
      ];

  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        if (filePath.endsWith('.json')) {
          const content = fs.readFileSync(filePath, 'utf-8');
          return JSON.parse(content) as ApiTraceUserConfig;
        } else {
          // Dynamic require for CommonJS/JS config
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod = require(filePath);
          return (mod.default || mod) as ApiTraceUserConfig;
        }
      } catch (err) {
        console.warn(`[api-trace-studio] Warning: Failed to load config from ${filePath}:`, (err as Error).message);
      }
    }
  }

  return {};
}

export function loadEnvConfig(): ApiTraceUserConfig {
  const env = process.env;
  const config: ApiTraceUserConfig = {};

  if (env.API_TRACE_SERVICE_NAME) config.serviceName = env.API_TRACE_SERVICE_NAME;
  if (env.API_TRACE_ENV || env.NODE_ENV) config.environment = env.API_TRACE_ENV || env.NODE_ENV;
  if (env.API_TRACE_LOG_LEVEL) config.logLevel = env.API_TRACE_LOG_LEVEL.toLowerCase() as LogLevel;

  // Storage
  if (
    env.API_TRACE_STORAGE_DIR ||
    env.API_TRACE_STORAGE_TYPE ||
    env.API_TRACE_STORAGE_MAX_SIZE_MB ||
    env.API_TRACE_STORAGE_MAX_FILES
  ) {
    config.storage = {};
    if (env.API_TRACE_STORAGE_DIR) config.storage.directory = env.API_TRACE_STORAGE_DIR;
    if (env.API_TRACE_STORAGE_TYPE) config.storage.type = env.API_TRACE_STORAGE_TYPE as any;
    if (env.API_TRACE_STORAGE_MAX_SIZE_MB) {
      config.storage.maxSizeBytes = parseInt(env.API_TRACE_STORAGE_MAX_SIZE_MB, 10) * 1024 * 1024;
    }
    if (env.API_TRACE_STORAGE_MAX_FILES) {
      config.storage.maxFiles = parseInt(env.API_TRACE_STORAGE_MAX_FILES, 10);
    }
  }

  // Dashboard
  if (
    env.API_TRACE_DASHBOARD_ENABLED !== undefined ||
    env.API_TRACE_DASHBOARD_ENDPOINT ||
    env.API_TRACE_DASHBOARD_USER ||
    env.API_TRACE_DASHBOARD_PASS ||
    env.API_TRACE_DASHBOARD_AUTH_ENABLED !== undefined
  ) {
    if (!config.dashboard) {
      config.dashboard = {};
    }
    if (!config.dashboard.auth) {
      config.dashboard.auth = {};
    }
    if (env.API_TRACE_DASHBOARD_ENABLED !== undefined) {
      config.dashboard.enabled = env.API_TRACE_DASHBOARD_ENABLED === 'true';
    }
    if (env.API_TRACE_DASHBOARD_ENDPOINT) {
      config.dashboard.endpoint = env.API_TRACE_DASHBOARD_ENDPOINT;
    }
    if (env.API_TRACE_DASHBOARD_AUTH_ENABLED !== undefined) {
      config.dashboard.auth.enabled = env.API_TRACE_DASHBOARD_AUTH_ENABLED === 'true';
    }
    if (env.API_TRACE_DASHBOARD_USER) {
      config.dashboard.auth.username = env.API_TRACE_DASHBOARD_USER;
    }
    if (env.API_TRACE_DASHBOARD_PASS) {
      config.dashboard.auth.password = env.API_TRACE_DASHBOARD_PASS;
      config.dashboard.auth.enabled = true;
    }
  }

  // Performance
  if (
    env.API_TRACE_SLOW_API_THRESHOLD_MS ||
    env.API_TRACE_SLOW_FN_THRESHOLD_MS ||
    env.API_TRACE_SLOW_DB_THRESHOLD_MS
  ) {
    config.performance = {};
    if (env.API_TRACE_SLOW_API_THRESHOLD_MS) {
      config.performance.slowApiThresholdMs = parseInt(env.API_TRACE_SLOW_API_THRESHOLD_MS, 10);
    }
    if (env.API_TRACE_SLOW_FN_THRESHOLD_MS) {
      config.performance.slowFunctionThresholdMs = parseInt(env.API_TRACE_SLOW_FN_THRESHOLD_MS, 10);
    }
    if (env.API_TRACE_SLOW_DB_THRESHOLD_MS) {
      config.performance.slowDbThresholdMs = parseInt(env.API_TRACE_SLOW_DB_THRESHOLD_MS, 10);
    }
  }

  // Sampling
  if (env.API_TRACE_SAMPLING_RATE) {
    config.sampling = {
      rate: parseFloat(env.API_TRACE_SAMPLING_RATE),
    };
  }

  return config;
}

export function tryInferServiceName(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        return pkg.name;
      }
    }
  } catch {
    // ignore
  }
  return 'node-service';
}

export function initConfig(userConfig?: ApiTraceUserConfig, configFile?: string): ApiTraceConfig {
  const inferredName = tryInferServiceName();
  const baseDefaults: ApiTraceConfig = {
    ...DEFAULT_CONFIG,
    serviceName: inferredName,
  };

  const fileConfig = loadConfigFile(configFile);
  const envConfig = loadEnvConfig();

  // Merge order: baseDefaults -> fileConfig -> envConfig -> userConfig
  let merged = deepMerge(baseDefaults, fileConfig);
  merged = deepMerge(merged, envConfig);
  if (userConfig) {
    merged = deepMerge(merged, userConfig);
  }

  // Normalize dashboard endpoint
  if (!merged.dashboard.endpoint.startsWith('/')) {
    merged.dashboard.endpoint = '/' + merged.dashboard.endpoint;
  }
  // Trim trailing slash if not root
  if (merged.dashboard.endpoint.length > 1 && merged.dashboard.endpoint.endsWith('/')) {
    merged.dashboard.endpoint = merged.dashboard.endpoint.slice(0, -1);
  }

  activeConfig = merged;
  isInitialized = true;
  return activeConfig;
}

export function getConfig(): ApiTraceConfig {
  if (!isInitialized) {
    return initConfig();
  }
  return activeConfig;
}

export function setConfig(partialConfig: ApiTraceUserConfig): ApiTraceConfig {
  activeConfig = deepMerge(activeConfig, partialConfig);
  return activeConfig;
}

export function resetConfig(): void {
  activeConfig = { ...DEFAULT_CONFIG };
  isInitialized = false;
}

export * from './types';
export * from './defaults';
