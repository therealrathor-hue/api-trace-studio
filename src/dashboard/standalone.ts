import * as http from 'http';
import { dashboardMiddleware } from './router';
import { getConfig, setConfig } from '../config';

export interface StandaloneDashboardOptions {
  port?: number;
  host?: string;
  logDir?: string;
  auth?: {
    enabled: boolean;
    username?: string;
    password?: string;
  };
}

export function startStandaloneDashboard(options: StandaloneDashboardOptions = {}): Promise<http.Server> {
  const port = options.port || parseInt(process.env.PORT || '4000', 10);
  const host = options.host || '0.0.0.0';

  if (options.logDir) {
    setConfig({
      storage: {
        directory: options.logDir,
      },
    });
  }

  if (options.auth) {
    setConfig({
      dashboard: {
        auth: options.auth,
      },
    });
  }

  const handler = dashboardMiddleware();

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handler(req, res, () => {
        res.statusCode = 404;
        res.end('Not Found');
      });
    });

    server.listen(port, host, () => {
      console.log(`[api-trace-studio] Dashboard running at: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`);
      resolve(server);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}
