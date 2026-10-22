import { RequestContextManager } from '../context/request-context';
import { recordCapturedError } from '../errors';

/**
 * NestJS Interceptor helper:
 * Can be used as a Global Interceptor:
 * app.useGlobalInterceptors(new ApiTraceInterceptor());
 */
export class ApiTraceInterceptor {
  intercept(context: any, next: any): any {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest();
    const handler = context.getHandler();
    const controller = context.getClass();

    const spanName = `${controller?.name || 'Controller'}.${handler?.name || 'action'}`;
    RequestContextManager.addBreadcrumb(`Entering ${spanName}`, 'navigation');

    return next.handle();
  }
}

/**
 * NestJS Exception Filter helper:
 * app.useGlobalFilters(new ApiTraceExceptionFilter());
 */
export class ApiTraceExceptionFilter {
  catch(exception: unknown, host: any): void {
    recordCapturedError(exception);
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = (exception as any)?.status || (exception as any)?.statusCode || 500;
    const message = (exception as any)?.message || 'Internal server error';

    if (response && typeof response.status === 'function') {
      response.status(status).json({
        statusCode: status,
        message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
