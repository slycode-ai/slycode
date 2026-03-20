import * as fs from 'fs';
import * as path from 'path';

const VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const HELP = `
SlyCode v${VERSION} — AI-powered development workspace

Usage: slycode <command> [options]

Getting Started:
  start                Start all services
  stop                 Stop all services
  restart [service]    Restart all or a specific service (e.g. restart web)
  doctor               Check your environment is healthy

Service Management:
  service install      Auto-start on boot (Linux: systemd, macOS: launchd, Windows: Task Scheduler)
  service remove       Remove auto-start service
  service status       Check service status

  Without a service, use "slycode start" and "slycode stop" manually.
  With a service installed, SlyCode starts automatically when you log in.

Skills:
  skills list          Show installed and available skills
  skills check         Check for new or updated skills
  skills add <name>    Add a skill to your workspace
  skills reset <name>  Reset a skill to upstream version (overwrites changes)

Configuration:
  config               View all config settings
  config <key>         View a specific setting
  config <key> <value> Change a setting (e.g. config host 0.0.0.0)

Maintenance:
  update               Update SlyCode to latest and restart services
  sync                 Refresh skill updates from package (runs automatically on start)

Other:
  uninstall            Remove services and CLI tools (your files are preserved)
  --version, -v        Show version
  --help, -h           Show this help

Files:
  Ports and services:  slycode.config.js (in your workspace)
  API keys and config: .env (in your workspace)
  Run "slycode doctor" to verify everything is set up correctly.
`.trim();

export async function main(args: string[]): Promise<void> {
  const command = args[0];
  const subArgs = args.slice(1);

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  switch (command) {
    case 'start': {
      const { start } = await import('./start');
      await start(subArgs);
      break;
    }
    case 'stop': {
      const { stop } = await import('./stop');
      await stop(subArgs);
      break;
    }
    case 'restart': {
      const { restart } = await import('./restart');
      await restart(subArgs);
      break;
    }
    case 'service': {
      const { service } = await import('./service');
      await service(subArgs);
      break;
    }
    case 'doctor': {
      const { doctor } = await import('./doctor');
      await doctor(subArgs);
      break;
    }
    case 'skills': {
      const { skills } = await import('./skills');
      await skills(subArgs);
      break;
    }
    case 'config': {
      const { config } = await import('./config');
      await config(subArgs);
      break;
    }
    case 'sync': {
      const { sync } = await import('./sync');
      await sync(subArgs);
      break;
    }
    case 'update': {
      const { update } = await import('./update');
      await update(subArgs);
      break;
    }
    case 'uninstall': {
      const { uninstall } = await import('./uninstall');
      await uninstall(subArgs);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "slycode --help" for usage.');
      process.exit(1);
  }
}
