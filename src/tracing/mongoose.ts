import { getTracer } from './tracer';
import { getConfig } from '../config';

export function apiTraceMongoosePlugin(schema: any): void {
  const operations = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'countDocuments',
    'estimatedDocumentCount',
  ];

  for (const op of operations) {
    schema.pre(op, function (this: any, next: () => void) {
      const config = getConfig();
      if (!config.database.enabled || !config.database.mongoose) {
        return next();
      }

      const collectionName = this.model?.collection?.name || this.model?.modelName || 'collection';
      const spanName = `DB ${collectionName}.${op}`;
      const tracer = getTracer();

      const span = tracer.startSpan(spanName, {
        kind: 'client',
        attributes: {
          'db.system': 'mongodb',
          'db.collection': collectionName,
          'db.operation': op,
        },
      });

      this._apiTraceSpan = span;
      next();
    });

    schema.post(op, function (this: any, res: any, next: (err?: any) => void) {
      const span = this._apiTraceSpan;
      if (span) {
        span.end();
      }
      if (typeof next === 'function') {
        next();
      }
    });

    schema.post(op, function (this: any, error: any, res: any, next: (err?: any) => void) {
      const span = this._apiTraceSpan;
      if (span) {
        span.recordException(error);
        span.end();
      }
      if (typeof next === 'function') {
        next(error);
      }
    });
  }
}
