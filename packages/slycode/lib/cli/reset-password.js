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
exports.resetPassword = resetPassword;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const workspace_1 = require("./workspace");
async function resetPassword(_args) {
    (0, workspace_1.ensureStateDir)();
    const authPath = path.join((0, workspace_1.getStateDir)(), 'auth.json');
    let data = {};
    if (fs.existsSync(authPath)) {
        try {
            data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
        }
        catch {
            // Corrupt file — overwrite with a clean first-run state below.
            data = {};
        }
    }
    if (!data.passwordHash && fs.existsSync(authPath)) {
        console.log('No password is currently set — the dashboard will show the setup screen on next visit.');
        return;
    }
    const next = {
        schemaVersion: data.schemaVersion ?? 1,
        passwordHash: null,
        // Rotate the HMAC key alongside the version bump: defense-in-depth so a
        // previously-leaked sessionSecret cannot sign tokens for the new tokenVersion.
        // Mirrors clearPassword() in web/src/lib/auth.ts — keep in lockstep.
        sessionSecret: crypto.randomBytes(32).toString('hex'),
        tokenVersion: (data.tokenVersion ?? 0) + 1,
        lockouts: {},
    };
    const tmp = `${authPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, authPath);
    try {
        fs.chmodSync(authPath, 0o600);
    }
    catch {
        /* best effort */
    }
    console.log('Password cleared. All existing dashboard sessions have been signed out.');
    console.log('Open the dashboard to set a new password.');
}
//# sourceMappingURL=reset-password.js.map