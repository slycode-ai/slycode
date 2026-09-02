import { PtyScrapeTransport } from './pty-scrape.js';
import { OpenCodeApiTransport } from './opencode-api.js';
const instances = new Map();
export function getTransportById(id) {
    const key = id ?? 'pty-scrape';
    let t = instances.get(key);
    if (!t) {
        switch (key) {
            case 'pty-scrape':
                t = new PtyScrapeTransport();
                break;
            case 'opencode-api':
                t = new OpenCodeApiTransport();
                break;
            default:
                // Unknown/unimplemented transport id: fall back loudly to pty-scrape so
                // a typo in providers.json degrades to the known path, not a crash.
                console.warn(`[transport] Unknown transport '${key}' — falling back to pty-scrape`);
                t = new PtyScrapeTransport();
        }
        instances.set(key, t);
    }
    return t;
}
export function getTransport(providerConfig) {
    return getTransportById(providerConfig?.transport);
}
//# sourceMappingURL=index.js.map