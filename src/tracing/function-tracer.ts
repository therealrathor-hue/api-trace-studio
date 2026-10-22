import { getTracer } from './tracer';

export interface TraceOptions {
  name?: string;
  kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  attributes?: Record<string, unknown>;
  captureArgs?: boolean;
  captureResult?: boolean;
}

export function traceAsync<TArgs extends any[], TReturn>(
  nameOrFn: string | ((...args: TArgs) => Promise<TReturn>),
  maybeFn?: (...args: TArgs) => Promise<TReturn>,
  options?: TraceOptions
): (...args: TArgs) => Promise<TReturn> {
  const fnName = typeof nameOrFn === 'string' ? nameOrFn : nameOrFn.name || 'anonymousAsync';
  const targetFn = (typeof nameOrFn === 'function' ? nameOrFn : maybeFn) as (...args: TArgs) => Promise<TReturn>;

  if (typeof targetFn !== 'function') {
    throw new TypeError('[api-trace-studio] Target to traceAsync must be a function');
  }

  return async function (this: unknown, ...args: TArgs): Promise<TReturn> {
    const tracer = getTracer();
    const spanName = options?.name || fnName;
    const initialAttrs: Record<string, unknown> = {
      ...(options?.attributes || {}),
      function: fnName,
    };

    if (options?.captureArgs && args.length > 0) {
      initialAttrs['args'] = args;
    }

    return tracer.traceAsync(
      spanName,
      async (span) => {
        const result = await targetFn.apply(this, args);
        if (options?.captureResult && result !== undefined) {
          span.setAttribute('result', result);
        }
        return result;
      },
      initialAttrs
    );
  };
}

export function traceFunction<TArgs extends any[], TReturn>(
  nameOrFn: string | ((...args: TArgs) => TReturn),
  maybeFn?: (...args: TArgs) => TReturn,
  options?: TraceOptions
): (...args: TArgs) => TReturn {
  const fnName = typeof nameOrFn === 'string' ? nameOrFn : nameOrFn.name || 'anonymousSync';
  const targetFn = (typeof nameOrFn === 'function' ? nameOrFn : maybeFn) as (...args: TArgs) => TReturn;

  if (typeof targetFn !== 'function') {
    throw new TypeError('[api-trace-studio] Target to traceFunction must be a function');
  }

  return function (this: unknown, ...args: TArgs): TReturn {
    const tracer = getTracer();
    const spanName = options?.name || fnName;
    const initialAttrs: Record<string, unknown> = {
      ...(options?.attributes || {}),
      function: fnName,
    };

    if (options?.captureArgs && args.length > 0) {
      initialAttrs['args'] = args;
    }

    return tracer.traceSync(
      spanName,
      (span) => {
        const result = targetFn.apply(this, args);
        if (options?.captureResult && result !== undefined) {
          span.setAttribute('result', result);
        }
        return result;
      },
      initialAttrs
    );
  };
}

export interface TraceClassOptions {
  prefix?: string;
  include?: string[];
  exclude?: string[];
  captureArgs?: boolean;
  captureResult?: boolean;
}

export function traceClass<T extends { new (...args: any[]): any }>(
  TargetClass: T,
  options: TraceClassOptions = {}
): T {
  const className = TargetClass.name || 'Class';
  const prefix = options.prefix || className;
  const proto = TargetClass.prototype;

  if (!proto) return TargetClass;

  const propertyNames = Object.getOwnPropertyNames(proto);

  for (const prop of propertyNames) {
    if (prop === 'constructor') continue;
    if (options.exclude && options.exclude.includes(prop)) continue;
    if (options.include && !options.include.includes(prop)) continue;

    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    if (!descriptor || typeof descriptor.value !== 'function') continue;

    const originalMethod = descriptor.value;
    const spanName = `${prefix}.${prop}`;

    // Check if original is async (returns Promise or is async function)
    const isAsync = originalMethod.constructor.name === 'AsyncFunction';

    if (isAsync) {
      proto[prop] = traceAsync(spanName, originalMethod, {
        captureArgs: options.captureArgs,
        captureResult: options.captureResult,
      });
    } else {
      // Wrapper that checks if returned value is a Promise at runtime
      proto[prop] = function (this: unknown, ...args: any[]) {
        const tracer = getTracer();
        const span = tracer.startSpan(spanName, {
          attributes: { class: className, method: prop },
        });

        try {
          const result = originalMethod.apply(this, args);
          if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
            // It returned a promise
            return result
              .then((res: any) => {
                span.end();
                return res;
              })
              .catch((err: any) => {
                span.recordException(err);
                span.end();
                throw err;
              });
          } else {
            span.end();
            return result;
          }
        } catch (err) {
          span.recordException(err);
          span.end();
          throw err;
        }
      };
    }
  }

  return TargetClass;
}

/**
 * TypeScript method decorator:
 * @Trace('custom-span-name')
 * async myMethod() { ... }
 */
export function Trace(name?: string, options?: TraceOptions) {
  return function (
    _target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    if (typeof originalMethod !== 'function') return descriptor;

    const spanName = name || propertyKey;
    const isAsync = originalMethod.constructor.name === 'AsyncFunction';

    if (isAsync) {
      descriptor.value = traceAsync(spanName, originalMethod, options);
    } else {
      descriptor.value = traceFunction(spanName, originalMethod, options);
    }

    return descriptor;
  };
}
