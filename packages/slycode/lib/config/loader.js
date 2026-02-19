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
exports.DEFAULTS = void 0;
exports.loadConfig = loadConfig;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
exports.DEFAULTS = {
    ports: { web: 7591, bridge: 7592, messaging: 7593 },
    services: { web: true, bridge: true, messaging: true },
};
/**
 * Load slycode.config.js from a directory, merged with defaults.
 */
function loadConfig(dir) {
    const configPath = path.join(dir, 'slycode.config.js');
    let userConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            delete require.cache[require.resolve(configPath)];
            userConfig = require(configPath);
        }
        catch (err) {
            console.warn(`Warning: Could not load slycode.config.js: ${err}`);
        }
    }
    return {
        ports: { ...exports.DEFAULTS.ports, ...userConfig.ports },
        services: { ...exports.DEFAULTS.services, ...userConfig.services },
    };
}
//# sourceMappingURL=loader.js.map