import * as path from 'path';
import * as fs from 'fs';

export interface SlyCodeConfig {
  ports: {
    web: number;
    bridge: number;
    messaging: number;
  };
  services: {
    web: boolean;
    bridge: boolean;
    messaging: boolean;
  };
}

export const DEFAULTS: SlyCodeConfig = {
  ports: { web: 7591, bridge: 7592, messaging: 7593 },
  services: { web: true, bridge: true, messaging: true },
};

/**
 * Load slycode.config.js from a directory, merged with defaults.
 */
export function loadConfig(dir: string): SlyCodeConfig {
  const configPath = path.join(dir, 'slycode.config.js');
  let userConfig: Partial<SlyCodeConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      delete require.cache[require.resolve(configPath)];
      userConfig = require(configPath);
    } catch (err) {
      console.warn(`Warning: Could not load slycode.config.js: ${err}`);
    }
  }

  return {
    ports: { ...DEFAULTS.ports, ...userConfig.ports },
    services: { ...DEFAULTS.services, ...userConfig.services },
  };
}
