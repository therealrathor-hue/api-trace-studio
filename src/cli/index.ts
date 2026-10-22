import { runInit } from './init';
import { runValidate } from './validate';
import { runDoctor } from './doctor';
import { runClean } from './clean';
import { startStandaloneDashboard } from '../dashboard/standalone';

function printHelp(): void {
  console.log(`
api-trace-studio - Observability, logging & tracing studio for Node.js

USAGE:
  api-trace-studio <command> [options]

COMMANDS:
  init            Generate api-trace.config.js configuration file
  validate        Verify configuration, log storage permissions & redaction
  doctor          System diagnostics, storage footprint & runtime environment
  dashboard       Start standalone web dashboard server to view logs
  clean           Prune rotated log files to free disk space
  version, -v     Print package version
  help, -h        Show this help message

OPTIONS:
  init:
    --force                Overwrite existing configuration file

  validate:
    --config <path>        Path to custom configuration file

  dashboard:
    --port <number>        Port to run dashboard on (default: 4000)
    --logs <dir>           Directory containing log files (default: ./logs)

  clean:
    --all                  Delete all log files including active log
    --older-than <days>    Delete log files older than specified days

EXAMPLES:
  $ npx api-trace-studio init
  $ npx api-trace-studio validate
  $ npx api-trace-studio doctor
  $ npx api-trace-studio dashboard --port 4000
  $ npx api-trace-studio clean --older-than 7
`);
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  function getArgValue(flag: string): string | undefined {
    const idx = argv.indexOf(flag);
    if (idx !== -1 && idx + 1 < argv.length) {
      return argv[idx + 1];
    }
    return undefined;
  }

  function hasFlag(flag: string): boolean {
    return argv.includes(flag);
  }

  switch (command) {
    case 'init': {
      runInit({ force: hasFlag('--force') });
      break;
    }

    case 'validate': {
      const configPath = getArgValue('--config');
      const valid = runValidate(configPath);
      if (!valid) {
        process.exit(1);
      }
      break;
    }

    case 'doctor':
    case 'diag':
    case 'diagnostics': {
      runDoctor();
      break;
    }

    case 'dashboard':
    case 'ui':
    case 'view': {
      const portStr = getArgValue('--port');
      const logsDir = getArgValue('--logs');
      const port = portStr ? parseInt(portStr, 10) : 4000;
      await startStandaloneDashboard({ port, logDir: logsDir });
      break;
    }

    case 'clean':
    case 'prune': {
      const olderThanStr = getArgValue('--older-than');
      runClean({
        all: hasFlag('--all'),
        olderThanDays: olderThanStr ? parseInt(olderThanStr, 10) : undefined,
      });
      break;
    }

    case 'version':
    case '-v':
    case '--version': {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require('../../package.json');
        console.log(`api-trace-studio v${pkg.version}`);
      } catch {
        console.log('api-trace-studio v1.0.0');
      }
      break;
    }

    case 'help':
    case '-h':
    case '--help':
    default: {
      printHelp();
      break;
    }
  }
}
