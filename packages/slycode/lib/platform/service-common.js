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
exports.SERVICES = void 0;
exports.resolveEntryPoint = resolveEntryPoint;
exports.resolveWrapperScript = resolveWrapperScript;
exports.loadEnvFile = loadEnvFile;
exports.getEnabledServices = getEnabledServices;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const workspace_1 = require("../cli/workspace");
const service_detect_1 = require("./service-detect");
Object.defineProperty(exports, "SERVICES", { enumerable: true, get: function () { return service_detect_1.SERVICES; } });
/**
 * Resolve the entry point for a service.
 * Web uses server.js (Next.js standalone), others use index.js.
 */
function resolveEntryPoint(service, workspace) {
    const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
    const distDir = packageDir ? path.join(packageDir, 'dist') : null;
    // Web uses server.js (Next.js standalone), others use index.js
    const entryFile = service === 'web' ? 'server.js' : 'index.js';
    if (distDir) {
        const distPath = path.join(distDir, service, entryFile);
        if (fs.existsSync(distPath))
            return distPath;
    }
    // Fallback to local dev build
    if (service === 'web') {
        return path.join(workspace, 'web', 'node_modules', '.bin', 'next');
    }
    return path.join(workspace, service, 'dist', 'index.js');
}
/**
 * Resolve the env wrapper script path.
 */
function resolveWrapperScript(workspace) {
    const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
    const wrapperPath = packageDir
        ? path.join(packageDir, 'dist', 'scripts', 'slycode-env-wrapper.sh')
        : path.join(workspace, 'packages', 'slycode', 'src', 'platform', 'slycode-env-wrapper.sh');
    return wrapperPath;
}
/**
 * Load .env from the workspace and return key=value pairs.
 * Used by service installers for enablement checks (e.g. messaging tokens).
 */
function loadEnvFile(workspace) {
    const envFile = path.join(workspace, '.env');
    const vars = {};
    if (!fs.existsSync(envFile))
        return vars;
    for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
            const key = trimmed.slice(0, eq);
            const val = trimmed.slice(eq + 1);
            if (val)
                vars[key] = val; // Only include non-empty values
        }
    }
    return vars;
}
/**
 * Determine which services should be installed.
 * Skips disabled services and messaging without channel tokens.
 */
function getEnabledServices(config, envVars) {
    const enabled = [];
    for (const svc of service_detect_1.SERVICES) {
        if (!config.services[svc]) {
            console.log(`  \u2298 ${svc}: disabled in config \u2014 skipping`);
            continue;
        }
        if (svc === 'messaging' && !envVars.TELEGRAM_BOT_TOKEN && !envVars.SLACK_TOKEN) {
            console.log(`  \u2298 messaging: no channels configured \u2014 skipping`);
            console.log('    (add TELEGRAM_BOT_TOKEN to .env, then run service install again)');
            continue;
        }
        enabled.push(svc);
    }
    return enabled;
}
//# sourceMappingURL=service-common.js.map