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
exports.config = config;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const workspace_1 = require("./workspace");
const USAGE = `
Usage: slycode config [key] [value]

View or modify slycode.config.js settings.

Examples:
  slycode config                    Show all settings
  slycode config host               Show current host binding
  slycode config host 0.0.0.0       Bind to all interfaces (remote access)
  slycode config host 127.0.0.1     Bind to localhost only (default, safest)

Configurable keys:
  host                Network binding address
  ports.web           Web UI port
  ports.bridge        Bridge port
  ports.messaging     Messaging port
  services.web        Enable/disable web service (true/false)
  services.bridge     Enable/disable bridge service (true/false)
  services.messaging  Enable/disable messaging service (true/false)

After changing config, restart services: slycode stop && slycode start
`.trim();
function readConfigFile(configPath) {
    try {
        delete require.cache[require.resolve(configPath)];
        return require(configPath);
    }
    catch {
        return {};
    }
}
function setNestedValue(obj, keyPath, value) {
    const parts = keyPath.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}
function getNestedValue(obj, keyPath) {
    const parts = keyPath.split('.');
    let current = obj;
    for (const part of parts) {
        if (typeof current !== 'object' || current === null)
            return undefined;
        current = current[part];
    }
    return current;
}
function generateConfigJs(config) {
    const host = config.host || '127.0.0.1';
    const ports = config.ports || {};
    const services = config.services || {};
    const hostComment = host === '0.0.0.0'
        ? '// Binding to 0.0.0.0 — accessible from other devices on your network'
        : '// Binding to 127.0.0.1 — only accessible from this machine (safest)';
    return `// SlyCode configuration
// See: https://github.com/slycode-ai/slycode#configuration

module.exports = {
  // Network binding for the web UI
  // '127.0.0.1' = localhost only (safest), '0.0.0.0' = all interfaces (remote access)
  // Internal services (bridge, messaging) always stay on localhost for safety.
  // Change with: slycode config host 0.0.0.0
  ${hostComment}
  host: '${host}',

  // Port configuration (SLY on phone keypad: 759x)
  // Web: the port you visit in your browser
  // Bridge/Messaging: internal services, not directly accessed
  ports: {
    web: ${ports.web ?? 7591},
    bridge: ${ports.bridge ?? 7592},
    messaging: ${ports.messaging ?? 7593},
  },

  // Enable/disable services
  services: {
    web: ${services.web ?? true},
    bridge: ${services.bridge ?? true},
    messaging: ${services.messaging ?? true},
  },
};
`;
}
async function config(args) {
    if (args[0] === '--help' || args[0] === '-h') {
        console.log(USAGE);
        return;
    }
    const workspace = (0, workspace_1.resolveWorkspaceOrExit)();
    const configPath = path.join(workspace, 'slycode.config.js');
    if (!fs.existsSync(configPath)) {
        console.error('No slycode.config.js found in workspace.');
        console.error(`Expected: ${configPath}`);
        process.exit(1);
    }
    const currentConfig = readConfigFile(configPath);
    // No args: show all config
    if (args.length === 0) {
        console.log(`Config: ${configPath}`);
        console.log('');
        console.log(`  host:               ${currentConfig.host || '127.0.0.1'}`);
        const ports = currentConfig.ports || {};
        console.log(`  ports.web:          ${ports.web ?? 7591}`);
        console.log(`  ports.bridge:       ${ports.bridge ?? 7592}`);
        console.log(`  ports.messaging:    ${ports.messaging ?? 7593}`);
        const services = currentConfig.services || {};
        console.log(`  services.web:       ${services.web ?? true}`);
        console.log(`  services.bridge:    ${services.bridge ?? true}`);
        console.log(`  services.messaging: ${services.messaging ?? true}`);
        return;
    }
    const key = args[0];
    const validKeys = [
        'host',
        'ports.web', 'ports.bridge', 'ports.messaging',
        'services.web', 'services.bridge', 'services.messaging',
    ];
    if (!validKeys.includes(key)) {
        console.error(`Unknown config key: ${key}`);
        console.error(`Valid keys: ${validKeys.join(', ')}`);
        process.exit(1);
    }
    // One arg: show value
    if (args.length === 1) {
        const value = getNestedValue(currentConfig, key);
        console.log(value !== undefined ? String(value) : '(not set)');
        return;
    }
    // Two args: set value
    let newValue = args[1];
    // Type coercion
    if (key.startsWith('ports.')) {
        const parsed = parseInt(args[1], 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
            console.error('Port must be a number between 1 and 65535.');
            process.exit(1);
        }
        newValue = parsed;
    }
    else if (key.startsWith('services.')) {
        if (!['true', 'false'].includes(args[1])) {
            console.error('Service values must be true or false.');
            process.exit(1);
        }
        newValue = args[1] === 'true';
    }
    else if (key === 'host') {
        if (!['127.0.0.1', '0.0.0.0', 'localhost'].includes(args[1])) {
            console.error('Host must be 127.0.0.1 (localhost only) or 0.0.0.0 (all interfaces).');
            process.exit(1);
        }
    }
    setNestedValue(currentConfig, key, newValue);
    fs.writeFileSync(configPath, generateConfigJs(currentConfig));
    console.log(`Set ${key} = ${newValue}`);
    console.log('Restart services for changes to take effect: slycode stop && slycode start');
}
//# sourceMappingURL=config.js.map