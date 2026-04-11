import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { execSync } from 'child_process';

const USAGE = `
Usage: npx create-slycode [directory]

Creates a new SlyCode workspace.

Options:
  --yes, -y     Accept all defaults (non-interactive)
  --help, -h    Show this help message

Examples:
  npx create-slycode              # Create in ./slycode
  npx create-slycode my-workspace # Create in ./my-workspace
  npx create-slycode .            # Create in current directory
`.trim();

interface SetupAnswers {
  timezone: string;
  host: string;
  webPort: number;
  bridgePort: number;
  messagingPort: number;
  telegramToken: string;
  telegramUserId: string;
  openaiKey: string;
  elevenLabsKey: string;
  elevenLabsVoiceId: string;
  installService: boolean;
}

function prompt(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function promptYN(rl: readline.Interface, question: string, defaultYes: boolean = false): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  return new Promise((resolve) => {
    rl.question(`  ${question} ${hint} `, (answer) => {
      if (!answer.trim()) resolve(defaultYes);
      else resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function runSetup(rl: readline.Interface, autoYes: boolean): Promise<SetupAnswers> {
  // Detect system timezone
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  if (autoYes) {
    return {
      timezone: detectedTz,
      host: '0.0.0.0',
      webPort: 7591,
      bridgePort: 7592,
      messagingPort: 7593,
      telegramToken: '',
      telegramUserId: '',
      openaiKey: '',
      elevenLabsKey: '',
      elevenLabsVoiceId: '',
      installService: false,
    };
  }

  // --- Timezone ---
  console.log('');
  console.log('  Timezone');
  console.log('  ────────');
  console.log('  Used for scheduling automations (cron). Press Enter to accept the');
  console.log('  detected timezone, or type an IANA timezone (e.g. America/New_York).');
  console.log('');
  const timezone = await prompt(rl, 'Timezone', detectedTz);

  // --- Network binding ---
  console.log('');
  console.log('  Web UI access');
  console.log('  ─────────────');
  console.log('  By default, the web UI only listens on localhost (127.0.0.1). This means');
  console.log('  you can only access it from this machine. Internal services (bridge,');
  console.log('  messaging) always stay on localhost for safety.');
  console.log('');
  console.log('  If you access this machine remotely (e.g. via Tailscale, SSH, or a VPN),');
  console.log('  you can bind the web UI to all interfaces (0.0.0.0) so it\'s reachable');
  console.log('  from other devices. Only do this on a trusted network.');
  console.log('');
  const bindAll = await promptYN(rl, 'Allow remote access to web UI? (bind to 0.0.0.0)');
  const host = bindAll ? '0.0.0.0' : '127.0.0.1';

  // --- Ports ---
  console.log('');
  console.log('  Ports');
  console.log('  ─────');
  console.log('  SlyCode runs three services. Default ports use "SLY" on a phone keypad (759x).');
  console.log('  The web port is the one you open in your browser. The others are internal.');
  console.log('  Press Enter to accept defaults.');
  console.log('');

  const webPortStr = await prompt(rl, 'Web UI port (this is the URL you visit)', '7591');
  const webPort = parseInt(webPortStr, 10) || 7591;
  const bridgePortStr = await prompt(rl, 'Bridge port (internal — terminal sessions)', '7592');
  const bridgePort = parseInt(bridgePortStr, 10) || 7592;
  const messagingPortStr = await prompt(rl, 'Messaging port (internal — Telegram/Slack)', '7593');
  const messagingPort = parseInt(messagingPortStr, 10) || 7593;

  // --- Telegram ---
  console.log('');
  console.log('  Telegram (optional)');
  console.log('  ───────────────────');
  console.log('  Connect a Telegram bot to send/receive messages from your workspace.');
  console.log('  You can set this up later by editing the .env file in your workspace.');
  console.log('  To create a bot: message @BotFather on Telegram and use /newbot.');
  console.log('');

  const telegramToken = await prompt(rl, 'Telegram bot token (Enter to skip)');
  let telegramUserId = '';
  if (telegramToken) {
    telegramUserId = await prompt(rl, 'Your Telegram user ID (message @userinfobot to find it)');
  }

  // --- Voice (STT/TTS) ---
  console.log('');
  console.log('  Voice (optional)');
  console.log('  ────────────────');
  console.log('  Enable voice messages: speech-to-text uses OpenAI Whisper,');
  console.log('  text-to-speech uses ElevenLabs. Both are optional — text messaging');
  console.log('  works without them. You can configure these later via .env or Telegram commands.');
  console.log('');

  const openaiKey = await prompt(rl, 'OpenAI API key for voice transcription (Enter to skip)');
  const elevenLabsKey = await prompt(rl, 'ElevenLabs API key for voice replies (Enter to skip)');
  let elevenLabsVoiceId = '';
  if (elevenLabsKey) {
    elevenLabsVoiceId = await prompt(rl, 'ElevenLabs voice ID (Enter for default)');
  }

  // --- System service ---
  let installService = false;
  if (process.platform !== 'win32') {
    console.log('');
    console.log('  System service (optional)');
    console.log('  ────────────────────────');
    console.log('  Install SlyCode as a system service so it starts automatically on boot.');
    console.log('  Without this, you start/stop manually with: npx slycode start / stop');
    console.log('');

    installService = await promptYN(rl, 'Install as system service?');
  }

  return {
    timezone, host, webPort, bridgePort, messagingPort,
    telegramToken, telegramUserId,
    openaiKey, elevenLabsKey, elevenLabsVoiceId,
    installService,
  };
}

function writeEnvFile(dir: string, answers: SetupAnswers): void {
  const lines: string[] = [
    '# ── Timezone ───────────────────────────────────────────────────────',
    '# IANA timezone for cron schedule evaluation',
    '# See: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones',
    `TZ=${answers.timezone}`,
    '',
    '# ── Ports ──────────────────────────────────────────────────────────',
    '# Web UI: the port you open in your browser (http://localhost:7591)',
    `WEB_PORT=${answers.webPort}`,
    '# Bridge: internal service for terminal sessions (not directly accessed)',
    `BRIDGE_PORT=${answers.bridgePort}`,
    '# Messaging: internal service for Telegram/Slack (not directly accessed)',
    `MESSAGING_SERVICE_PORT=${answers.messagingPort}`,
    '',
    '# Bridge URL (used by the web UI to reach the bridge — set automatically)',
    `BRIDGE_URL=http://127.0.0.1:${answers.bridgePort}`,
    '',
    '# ── Telegram (optional) ────────────────────────────────────────────',
    '# Connect a Telegram bot to interact with your workspace remotely.',
    '# Create a bot: message @BotFather on Telegram, use /newbot.',
    `TELEGRAM_BOT_TOKEN=${answers.telegramToken}`,
    '# Your Telegram user ID (message @userinfobot to find it).',
    '# This restricts the bot to only respond to you.',
    `TELEGRAM_USER_ID=${answers.telegramUserId}`,
    '',
    '# ── Voice: Speech-to-Text (optional) ──────────────────────────────',
    '# Backend: openai (default) | aws-transcribe | local',
    '# STT_BACKEND=openai',
    '#',
    '# OpenAI Whisper API. Get a key at: https://platform.openai.com/api-keys',
    `OPENAI_API_KEY=${answers.openaiKey}`,
    '#',
    '# AWS Transcribe (set STT_BACKEND=aws-transcribe)',
    '# Uses EC2 instance IAM role — no AWS credentials needed on EC2',
    '# Required IAM: transcribe:StartTranscriptionJob, transcribe:GetTranscriptionJob,',
    '#   s3:PutObject, s3:GetObject (on the bucket below)',
    '# AWS_TRANSCRIBE_REGION=ap-southeast-2',
    '# AWS_TRANSCRIBE_LANGUAGE=en-AU',
    '# AWS_TRANSCRIBE_S3_BUCKET=your-bucket-name',
    '',
    '# ── Voice: Text-to-Speech (optional) ──────────────────────────────',
    '# Used to send voice replies back to you via Telegram.',
    '# Uses ElevenLabs API. Get a key at: https://elevenlabs.io/app/settings/api-keys',
    `ELEVENLABS_API_KEY=${answers.elevenLabsKey}`,
    '# Voice ID for TTS. Browse voices at: https://elevenlabs.io/voice-library',
    `ELEVENLABS_VOICE_ID=${answers.elevenLabsVoiceId}`,
    '# Speech speed (1.0 = normal, 0.5 = slow, 1.5 = fast)',
    'ELEVENLABS_SPEED=1.00',
    '',
  ];

  fs.writeFileSync(path.join(dir, '.env'), lines.join('\n'));
}

function writeGitignore(dir: string): void {
  const content = `# Dependencies
node_modules/

# Environment
.env

# Build output
dist/
.next/

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# State
.slycode/
`;
  fs.writeFileSync(path.join(dir, '.gitignore'), content);
}

function getSlycodeVersion(): string {
  // Read version from our own package's dependency on @slycode/slycode
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const dep = pkg.dependencies?.['@slycode/slycode'];
    if (dep) return dep;
  } catch { /* fallback */ }
  return '*';
}

function writePackageJson(dir: string, name: string): void {
  const pkg = {
    name,
    version: '1.0.0',
    private: true,
    description: 'SlyCode workspace',
    scripts: {
      start: 'slycode start',
      stop: 'slycode stop',
      doctor: 'slycode doctor',
    },
    dependencies: {
      '@slycode/slycode': getSlycodeVersion(),
    },
  };

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

function writeDefaultConfig(dir: string, answers: SetupAnswers): void {
  const hostComment = answers.host === '0.0.0.0'
    ? '// Binding to 0.0.0.0 — accessible from other devices on your network'
    : '// Binding to 127.0.0.1 — only accessible from this machine (safest)';
  const content = `// SlyCode configuration
// See: https://github.com/slycode-ai/slycode#configuration

module.exports = {
  // Network binding for the web UI
  // '127.0.0.1' = localhost only (safest), '0.0.0.0' = all interfaces (remote access)
  // Internal services (bridge, messaging) always stay on localhost for safety.
  // Change with: slycode config host 0.0.0.0
  ${hostComment}
  host: '${answers.host}',

  // Port configuration (SLY on phone keypad: 759x)
  // Web: the port you visit in your browser
  // Bridge/Messaging: internal services, not directly accessed
  ports: {
    web: ${answers.webPort},
    bridge: ${answers.bridgePort},
    messaging: ${answers.messagingPort},
  },

  // Enable/disable services
  services: {
    web: true,
    bridge: true,
    messaging: true,
  },
};
`;
  fs.writeFileSync(path.join(dir, 'slycode.config.js'), content);
}

function copyTemplates(dir: string): void {
  // Create workspace directory structure
  const dirs = [
    'store/skills',
    'data',
    'documentation',
    'projects',
  ];

  for (const d of dirs) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }

  // Seed kanban.json (overwritten by tutorial seed if template is available)
  const kanbanSeed = {
    project_id: 'slycode',
    stages: { backlog: [], design: [], implementation: [], testing: [], done: [] },
    last_updated: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'documentation', 'kanban.json'), JSON.stringify(kanbanSeed, null, 2) + '\n');

  // Seed commands.json
  const commandsSeed = {
    schemaVersion: 1,
    commands: [],
  };
  fs.writeFileSync(
    path.join(dir, 'data', 'commands.json'),
    JSON.stringify(commandsSeed, null, 2) + '\n'
  );

  // Seed registry (workspace-root tutorial project is the default/only project)
  const registrySeed = {
    schemaVersion: 1,
    projects: [
      {
        id: 'slycode',
        name: 'SlyCode',
        description: 'SlyCode workspace with built-in interactive tutorial',
        path: dir,
        hasClaudeMd: true,
        masterCompliant: false,
        areas: [],
        tags: ['tutorial'],
        order: 100,
      },
    ],
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(dir, 'projects', 'registry.json'),
    JSON.stringify(registrySeed, null, 2) + '\n'
  );

  // Actions are now individual MD files in store/actions/ — seeded by deployStoreActions()
}

/**
 * Copy store skills from the slycode package templates into the flat canonical store,
 * then deploy them to .claude/skills/ and .agents/skills/ for the global terminal.
 */
function findStoreTemplates(workspaceDir: string): string | null {
  // 1. Normal: installed slycode package in the workspace
  const installed = path.join(workspaceDir, 'node_modules', '@slycode', 'slycode', 'templates', 'store');
  if (fs.existsSync(installed)) return installed;

  // 2. Dev/monorepo: sibling packages/slycode relative to create-slycode
  const devSibling = path.join(__dirname, '..', '..', 'slycode', 'templates', 'store');
  if (fs.existsSync(devSibling)) return devSibling;

  return null;
}

function deployStoreAndSkills(dir: string): void {
  const storeTemplates = findStoreTemplates(dir);
  if (!storeTemplates) return;

  const srcDir = path.join(storeTemplates, 'skills');
  if (!fs.existsSync(srcDir)) return;

  const storeDir = path.join(dir, 'store', 'skills');
  const deployTargets = ['.claude/skills', '.agents/skills'];

  // Ensure deploy directories exist
  for (const target of deployTargets) {
    fs.mkdirSync(path.join(dir, target), { recursive: true });
  }

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillSrc = path.join(srcDir, entry.name);

    // Copy to flat canonical store
    const storeDest = path.join(storeDir, entry.name);
    if (!fs.existsSync(storeDest)) {
      copyDirRecursive(skillSrc, storeDest);
    }

    // Deploy to all provider directories (for global terminal)
    for (const target of deployTargets) {
      const deployDest = path.join(dir, target, entry.name);
      if (!fs.existsSync(deployDest)) {
        copyDirRecursive(skillSrc, deployDest);
      }
    }
  }
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Seed workspace-root tutorial content from the tutorial project template.
 * This keeps tutorial source assets in templates/tutorial-project/ while making
 * the installed workspace root itself the tutorial experience.
 */
function seedTutorialWorkspaceContent(dir: string): void {
  const tutorialTemplate = findTemplateFile(dir, 'tutorial-project');
  if (!tutorialTemplate) {
    // Template not found — skip silently (don't crash scaffold)
    return;
  }

  const copyIfExists = (relativePath: string): void => {
    const src = path.join(tutorialTemplate, relativePath);
    const dest = path.join(dir, relativePath);
    if (fs.existsSync(src)) {
      copyDirRecursive(src, dest);
    }
  };

  // Seed tutorial documentation into workspace root.
  copyIfExists(path.join('documentation', 'designs'));
  copyIfExists(path.join('documentation', 'features'));

  const tutorialKanban = path.join(tutorialTemplate, 'documentation', 'kanban.json');
  if (fs.existsSync(tutorialKanban)) {
    let content = fs.readFileSync(tutorialKanban, 'utf-8');
    content = content.replace(/\{\{TIMESTAMP\}\}/g, new Date().toISOString());
    fs.writeFileSync(path.join(dir, 'documentation', 'kanban.json'), content);
  }

  const tutorialEvents = path.join(tutorialTemplate, 'documentation', 'events.json');
  if (fs.existsSync(tutorialEvents)) {
    fs.copyFileSync(tutorialEvents, path.join(dir, 'documentation', 'events.json'));
  }

  console.log('  \u2713 Tutorial content seeded into workspace root');
}

/**
 * Copy the updates/ folder from the slycode package into the workspace.
 * This folder contains the latest baseline skills for the update delivery system.
 */
function findTemplateFile(workspaceDir: string, relativePath: string): string | null {
  const installed = path.join(workspaceDir, 'node_modules', '@slycode', 'slycode', 'templates', relativePath);
  if (fs.existsSync(installed)) return installed;

  const devSibling = path.join(__dirname, '..', '..', 'slycode', 'templates', relativePath);
  if (fs.existsSync(devSibling)) return devSibling;

  return null;
}

function deployStoreActions(dir: string): void {
  const storeTemplates = findStoreTemplates(dir);
  if (!storeTemplates) return;

  const srcDir = path.join(storeTemplates, 'actions');
  if (!fs.existsSync(srcDir)) return;

  const storeDir = path.join(dir, 'store', 'actions');
  fs.mkdirSync(storeDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir)) {
    if (!entry.endsWith('.md')) continue;
    const dest = path.join(storeDir, entry);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(srcDir, entry), dest);
    }
  }
}

function deployUpdatesFolder(dir: string): void {
  const updatesTemplates = findTemplateFile(dir, 'updates');
  if (!updatesTemplates) return;

  const dest = path.join(dir, 'updates');
  // Always overwrite — updates/ is controlled by the package, not the user
  copyDirRecursive(updatesTemplates, dest);
}

function copyCLAUDEmd(dir: string): void {
  const src = findTemplateFile(dir, 'CLAUDE.md');
  const dest = path.join(dir, 'CLAUDE.md');
  if (src && !fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }
}

export async function main(args: string[]): Promise<void> {
  // Parse args
  let targetDir = 'slycode';
  let autoYes = false;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      return;
    }
    if (arg === '--yes' || arg === '-y') {
      autoYes = true;
    } else if (!arg.startsWith('-')) {
      targetDir = arg;
    }
  }

  // Normalize Unicode tildes (U+02DC small tilde, U+FF5E fullwidth tilde) to ASCII
  targetDir = targetDir.replace(/^[\u02dc\uff5e]/, '~');
  // Expand tilde to home directory
  if (targetDir.startsWith('~/') || targetDir === '~') {
    targetDir = targetDir.replace(/^~/, require('os').homedir());
  }
  // Reject relative paths (defensive — shell normally expands ~, but programmatic callers may not)
  if (!path.isAbsolute(targetDir) && targetDir !== 'slycode') {
    console.error('  Error: Please provide an absolute path (e.g. ~/Dev/myproject or /home/user/Dev/myproject)');
    process.exit(1);
  }

  const resolvedDir = path.resolve(targetDir);
  const dirName = path.basename(resolvedDir);

  console.log('');
  console.log('  Creating SlyCode workspace...');
  console.log(`  Directory: ${resolvedDir}`);
  console.log('');

  // Check for existing workspace
  const slycodeConfigDir = path.join(require('os').homedir(), '.slycode');
  const slycodeConfigFile = path.join(slycodeConfigDir, 'config.json');
  if (fs.existsSync(slycodeConfigFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(slycodeConfigFile, 'utf-8'));
      if (existing.home && existing.home !== resolvedDir && fs.existsSync(existing.home)) {
        console.log(`  You already have a SlyCode workspace at:`);
        console.log(`    ${existing.home}`);
        console.log('');
        console.log('  Creating a new workspace will replace it as the default.');
        console.log('  The existing workspace files will NOT be deleted, but');
        console.log('  global commands (sly-kanban, etc.) will point to the new one.');
        console.log('');
        console.log('  If you want to update your existing workspace instead:');
        console.log(`    cd ${existing.home} && npm update @slycode/slycode`);
        console.log('');
        if (!autoYes) {
          const rlCheck = readline.createInterface({ input: process.stdin, output: process.stdout });
          const proceed = await new Promise<boolean>((resolve) => {
            rlCheck.question('  Continue creating a new workspace? [y/N] ', (answer) => {
              rlCheck.close();
              resolve(answer.toLowerCase() === 'y');
            });
          });
          if (!proceed) {
            console.log('  Cancelled.');
            return;
          }
          console.log('');
        }
      }
    } catch { /* config unreadable, proceed */ }
  }

  // Check if directory exists and has content (validate before prompting)
  const dirAlreadyExists = fs.existsSync(resolvedDir);
  if (dirAlreadyExists) {
    const entries = fs.readdirSync(resolvedDir);
    if (entries.length > 0 && !entries.every(e => e.startsWith('.'))) {
      console.error(`  Error: ${resolvedDir} is not empty.`);
      console.error('  Use an empty directory or specify a new one.');
      process.exit(1);
    }
  }

  // Create readline interface early — used for upfront confirmation and setup wizard
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answers: SetupAnswers;
  try {
    // Upfront confirmation — verify the user is happy with the install location
    if (!autoYes) {
      const proceed = await promptYN(rl, 'Install SlyCode here?', true);
      if (!proceed) {
        console.log('  Cancelled.');
        return;
      }
      console.log('');
    }

    // Create directory only after confirmation
    if (!dirAlreadyExists) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    answers = await runSetup(rl, autoYes);
  } finally {
    rl.close();
  }

  console.log('');
  console.log('  Scaffolding workspace...');

  // Create workspace files
  writePackageJson(resolvedDir, dirName);
  writeDefaultConfig(resolvedDir, answers);
  writeEnvFile(resolvedDir, answers);
  writeGitignore(resolvedDir);
  copyTemplates(resolvedDir);

  console.log('  \u2713 Workspace structure created');

  // npm install
  console.log('  Installing dependencies (this may take a minute)...');
  try {
    execSync('npm install', {
      cwd: resolvedDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('  \u2713 Dependencies installed');
  } catch (err) {
    console.error('  \u2717 npm install failed. Run manually: cd ' + resolvedDir + ' && npm install');
  }

  // Deploy store skills and actions to workspace and provider directories
  deployStoreAndSkills(resolvedDir);
  deployStoreActions(resolvedDir);
  deployUpdatesFolder(resolvedDir);
  copyCLAUDEmd(resolvedDir);

  // Seed workspace-root tutorial content
  seedTutorialWorkspaceContent(resolvedDir);

  // Seed providers.json from package templates
  const providersTemplate = findTemplateFile(resolvedDir, 'providers.json');
  if (providersTemplate) {
    const providersDest = path.join(resolvedDir, 'data', 'providers.json');
    if (!fs.existsSync(providersDest)) {
      fs.copyFileSync(providersTemplate, providersDest);
    }
  }

  // Seed terminal-classes.json from package templates
  const tcTemplate = findTemplateFile(resolvedDir, 'terminal-classes.json');
  if (tcTemplate) {
    const tcDest = path.join(resolvedDir, 'documentation', 'terminal-classes.json');
    if (!fs.existsSync(tcDest)) {
      fs.mkdirSync(path.join(resolvedDir, 'documentation'), { recursive: true });
      fs.copyFileSync(tcTemplate, tcDest);
    }
  }

  // Save workspace path to ~/.slycode/config.json
  try {
    const slycodeDir = path.join(require('os').homedir(), '.slycode');
    if (!fs.existsSync(slycodeDir)) {
      fs.mkdirSync(slycodeDir, { recursive: true });
    }
    const configFile = path.join(slycodeDir, 'config.json');
    const config: Record<string, unknown> = {};
    if (fs.existsSync(configFile)) {
      try { Object.assign(config, JSON.parse(fs.readFileSync(configFile, 'utf-8'))); } catch { /* ok */ }
    }
    config.home = resolvedDir;
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
    console.log('  \u2713 Workspace path saved to ~/.slycode/config.json');
  } catch {
    // Non-fatal
  }

  // Link global CLI commands (slycode, sly-kanban, sly-messaging, sly-scaffold)
  try {
    const symlinksMod = path.join(resolvedDir, 'node_modules', '@slycode', 'slycode', 'lib', 'platform', 'symlinks.js');
    const devSymlinks = path.join(__dirname, '..', '..', 'slycode', 'lib', 'platform', 'symlinks.js');
    const symlinksPath = fs.existsSync(symlinksMod) ? symlinksMod : fs.existsSync(devSymlinks) ? devSymlinks : null;
    if (symlinksPath) {
      const { linkClis } = require(symlinksPath);
      linkClis(resolvedDir);
      console.log('  \u2713 Global CLI commands linked');
    }
  } catch {
    console.log('  ! Could not link CLI commands. Run later: npx slycode service install');
  }

  // Install as service if requested
  if (answers.installService) {
    console.log('  Installing as system service...');
    try {
      // Use direct require with dev fallback — avoids npx trying to download from npm
      const svcMod = path.join(resolvedDir, 'node_modules', '@slycode', 'slycode', 'lib', 'cli', 'index.js');
      const devSvcMod = path.join(__dirname, '..', '..', 'slycode', 'lib', 'cli', 'index.js');
      const cliPath = fs.existsSync(svcMod) ? svcMod : fs.existsSync(devSvcMod) ? devSvcMod : null;
      if (cliPath) {
        const { main } = require(cliPath);
        await main(['service', 'install']);
      } else {
        // Fallback to npx (works when slycode is published)
        execSync('npx slycode service install', {
          cwd: resolvedDir,
          stdio: 'inherit',
        });
      }
    } catch {
      console.log('  ! Service install failed. Run later: slycode service install');
    }
  }

  // Done!
  console.log('');
  console.log('  SlyCode is ready!');
  console.log('');

  if (targetDir !== '.') {
    if (process.platform === 'win32') {
      console.log('  ⚠  IMPORTANT: change into your workspace directory first:');
      console.log('');
      console.log(`     cd ${targetDir}`);
      console.log('');
      console.log('  Then run SlyCode commands:');
      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log('  │  WINDOWS: Use npx to run SlyCode commands:             │');
      console.log('  │                                                         │');
      console.log('  │    npx slycode start       Start all services           │');
      console.log('  │    npx slycode stop        Stop all services            │');
      console.log('  │    npx slycode doctor      Check environment            │');
      console.log('  │    npx slycode --help      See all commands             │');
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else if (process.platform === 'darwin') {
      console.log('  ⚠  macOS: cd into your workspace before running slycode:');
      console.log('');
      console.log(`     cd ${targetDir}`);
      console.log('     slycode start           Start all services');
      console.log('');
      console.log('  slycode doctor          Check environment');
      console.log('  slycode --help          See all commands');
    } else {
      console.log('  Next steps:');
      console.log('');
      console.log(`     cd ${targetDir}`);
      console.log('     slycode start           Start all services');
      console.log('');
      console.log('  slycode doctor          Check environment');
      console.log('  slycode --help          See all commands');
    }
  } else {
    // Installed in current directory — no cd needed
    if (process.platform === 'win32') {
      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log('  │  WINDOWS: Use npx to run SlyCode commands:             │');
      console.log('  │                                                         │');
      console.log('  │    npx slycode start       Start all services           │');
      console.log('  │    npx slycode stop        Stop all services            │');
      console.log('  │    npx slycode doctor      Check environment            │');
      console.log('  │    npx slycode --help      See all commands             │');
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else {
      console.log('  slycode start           Start all services');
      console.log('  slycode doctor          Check environment');
      console.log('  slycode --help          See all commands');
    }
  }
  console.log('');
}
