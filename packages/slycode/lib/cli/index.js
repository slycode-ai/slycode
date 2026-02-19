"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const VERSION = (() => {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
        return pkg.version || '0.0.0';
    }
    catch {
        return '0.0.0';
    }
})();
const HELP = `
SlyCode v${VERSION} — AI-powered development workspace

Usage: slycode <command> [options]

Getting Started:
  start                Start all services
  stop                 Stop all services
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
async function main(args) {
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
            const { start } = await Promise.resolve().then(() => __importStar(require('./start')));
            await start(subArgs);
            break;
        }
        case 'stop': {
            const { stop } = await Promise.resolve().then(() => __importStar(require('./stop')));
            await stop(subArgs);
            break;
        }
        case 'service': {
            const { service } = await Promise.resolve().then(() => __importStar(require('./service')));
            await service(subArgs);
            break;
        }
        case 'doctor': {
            const { doctor } = await Promise.resolve().then(() => __importStar(require('./doctor')));
            await doctor(subArgs);
            break;
        }
        case 'skills': {
            const { skills } = await Promise.resolve().then(() => __importStar(require('./skills')));
            await skills(subArgs);
            break;
        }
        case 'config': {
            const { config } = await Promise.resolve().then(() => __importStar(require('./config')));
            await config(subArgs);
            break;
        }
        case 'sync': {
            const { sync } = await Promise.resolve().then(() => __importStar(require('./sync')));
            await sync(subArgs);
            break;
        }
        case 'update': {
            const { update } = await Promise.resolve().then(() => __importStar(require('./update')));
            await update(subArgs);
            break;
        }
        case 'uninstall': {
            const { uninstall } = await Promise.resolve().then(() => __importStar(require('./uninstall')));
            await uninstall(subArgs);
            break;
        }
        default:
            console.error(`Unknown command: ${command}`);
            console.error('Run "slycode --help" for usage.');
            process.exit(1);
    }
}
//# sourceMappingURL=index.js.map