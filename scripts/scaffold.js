#!/usr/bin/env node

/**
 * Project Scaffold CLI Tool
 *
 * Creates SlyCode-compliant project workspaces.
 * Can analyze existing directories and scaffold new or partial setups.
 * Supports multiple AI providers (Claude, Codex, Gemini).
 *
 * Usage: node scripts/scaffold.js <command> [options]
 * Run with --help for more information.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const REPO_ROOT = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'data', 'scaffold-templates');
const OVERLAYS_DIR = path.join(TEMPLATES_DIR, 'overlays');
const COMMANDS_DIR = path.join(REPO_ROOT, '.claude', 'commands');
const STORE_DIR = path.join(REPO_ROOT, 'store');
const SKILLS_DIR = path.join(STORE_DIR, 'skills');
const AGENTS_DIR = path.join(STORE_DIR, 'agents');

// Essential skills — required for SlyCode core functionality
const ESSENTIAL_SKILLS = ['kanban', 'messaging'];

// Provider definitions — skillsDir is where skills get deployed for each provider
const PROVIDERS = {
  claude: { filename: 'CLAUDE.md', name: 'Claude Code', overlay: 'claude.md', skillsDir: '.claude/skills', agentsDir: '.claude/agents' },
  codex:  { filename: 'AGENTS.md', name: 'OpenAI Codex', overlay: 'codex.md', skillsDir: '.agents/skills', agentsDir: '.agents/agents' },
  gemini: { filename: 'GEMINI.md', name: 'Gemini CLI',   overlay: 'gemini.md', skillsDir: '.agents/skills', agentsDir: '.agents/agents' },
};

const VALID_PROVIDERS = Object.keys(PROVIDERS);
const DEFAULT_PROVIDERS = ['claude'];

// Scaffold groups — purpose-based organization for UI presentation
const SCAFFOLD_GROUPS = [
  {
    id: 'ai-config',
    name: 'AI Configuration',
    description: 'Instruction files for your AI coding agents and MCP server config',
    staticItems: ['.mcp.json'],
  },
  {
    id: 'project-mgmt',
    name: 'Project Management',
    description: 'Task tracking, event history, and archiving',
    staticItems: ['documentation/kanban.json', 'documentation/events.json', 'documentation/archive'],
  },
  {
    id: 'documentation',
    name: 'Documentation',
    description: 'Structured directories for specs, designs, and reference material',
    staticItems: [
      'documentation/chores',
      'documentation/chores/completed',
      'documentation/features',
      'documentation/designs',
      'documentation/interactive',
      'documentation/reference',
      'documentation/temp',
    ],
  },
  {
    id: 'skills-commands',
    name: 'Skills & Commands',
    description: 'Reusable AI capabilities deployed from the SlyCode store',
    staticItems: ['.claude/commands', '.claude/agents'],
    // .claude/skills/* added dynamically
  },
  {
    id: 'config',
    name: 'Config',
    description: 'Version control and tooling configuration',
    staticItems: ['.gitignore', '.git'],
  },
];

// ============================================================================
// Help Text
// ============================================================================

const MAIN_HELP = `
Usage: scaffold <command> [options]

Commands:
  analyze   Analyze a directory and report what exists vs what's missing
  create    Scaffold a new SlyCode-compliant project

Run 'scaffold <command> --help' for command-specific options.
`;

const ANALYZE_HELP = `
Usage: scaffold analyze --path <dir> [options]

Analyze a directory and return a JSON report of what exists vs what's missing
for SlyCode compliance.

Options:
  --path <dir>              Target directory to analyze (required)
  --providers <list>        Comma-separated providers to check (default: claude)
  --json                    Output raw JSON (default: formatted)

Examples:
  scaffold analyze --path /home/user/projects/my-project
  scaffold analyze --path ./project --providers claude,codex,gemini
`;

const CREATE_HELP = `
Usage: scaffold create --path <dir> --name <name> [options]

Scaffold a new SlyCode-compliant project workspace.

Options:
  --path <dir>              Target directory (required)
  --name <name>             Project name (required)
  --id <id>                 Project ID (default: kebab-case of name)
  --description <desc>      Project description
  --providers <list>        Comma-separated providers (default: claude)
                            Available: claude, codex, gemini
  --config <json>           JSON config for selective scaffolding

Examples:
  scaffold create --path /home/user/projects/my-app --name "My App"
  scaffold create --path ./app --name "App" --providers claude,codex
  scaffold create --path ./app --name "App" --providers claude,codex,gemini
`;

// ============================================================================
// Utility Functions
// ============================================================================

function expandTilde(p) {
  if (p.startsWith('~/') || p === '~') {
    const home = require('os').homedir();
    return p.replace(/^~/, home);
  }
  return p;
}

function toKebabCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function isDirEmpty(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath);
    return entries.length === 0;
  } catch {
    return true;
  }
}

function extractVersion(content) {
  const match = content.match(/^---\n[\s\S]*?version:\s*(.+)\n[\s\S]*?---/);
  return match ? match[1].trim() : 'unknown';
}

function copyDirRecursive(src, dest, { overwrite = false } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  const skipped = [];
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const childSkipped = copyDirRecursive(srcPath, destPath, { overwrite });
      skipped.push(...childSkipped);
    } else {
      if (!overwrite && fs.existsSync(destPath)) {
        skipped.push(destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  return skipped;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function replaceTemplateVars(content, vars) {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
  }
  return result;
}

function parseProviders(args) {
  const idx = args.indexOf('--providers');
  if (idx === -1 || !args[idx + 1]) return DEFAULT_PROVIDERS;

  const requested = args[idx + 1].split(',').map(p => p.trim().toLowerCase());
  const invalid = requested.filter(p => !VALID_PROVIDERS.includes(p));
  if (invalid.length > 0) {
    console.error(`Error: Unknown provider(s): ${invalid.join(', ')}`);
    console.error(`Valid providers: ${VALID_PROVIDERS.join(', ')}`);
    process.exit(1);
  }
  return requested;
}

// ============================================================================
// Template Assembly (base + overlay)
// ============================================================================

function loadOverlay(provider) {
  const overlayPath = path.join(OVERLAYS_DIR, PROVIDERS[provider].overlay);
  const content = fs.readFileSync(overlayPath, 'utf-8');

  // Parse overlay format: "KEY: value\n---\nKEY:\nmultiline value\n---\n..."
  const sections = {};
  const blocks = content.split('\n---\n');
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Find the first colon to split key from value
    const firstNewline = trimmed.indexOf('\n');
    const firstColon = trimmed.indexOf(':');

    if (firstColon === -1) continue;

    // Single-line value: "KEY: value"
    if (firstNewline === -1 || firstColon < firstNewline) {
      const key = trimmed.substring(0, firstColon).trim();
      const value = trimmed.substring(firstColon + 1).trim();
      sections[key] = value;
    }
  }
  return sections;
}

function assembleInstructionFile(provider, templateVars) {
  const base = fs.readFileSync(path.join(TEMPLATES_DIR, 'base-instructions.md'), 'utf-8');
  const overlay = loadOverlay(provider);

  // Replace overlay insertion points
  let content = base;
  for (const [key, value] of Object.entries(overlay)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  // Replace standard template variables
  content = replaceTemplateVars(content, templateVars);

  return content;
}

// ============================================================================
// Version Collection
// ============================================================================

function collectSkillVersions() {
  const versions = {};
  if (!dirExists(SKILLS_DIR)) return versions;

  const skills = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  for (const skill of skills) {
    if (!skill.isDirectory()) continue;
    const skillMd = path.join(SKILLS_DIR, skill.name, 'SKILL.md');
    if (fileExists(skillMd)) {
      const content = fs.readFileSync(skillMd, 'utf-8');
      versions[skill.name] = extractVersion(content);
    }
  }
  return versions;
}

function collectCommandVersions() {
  const versions = {};
  if (!dirExists(COMMANDS_DIR)) return versions;

  const commands = fs.readdirSync(COMMANDS_DIR);
  for (const cmd of commands) {
    if (!cmd.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(COMMANDS_DIR, cmd), 'utf-8');
    const name = cmd.replace('.md', '');
    versions[name] = extractVersion(content);
  }
  return versions;
}

// ============================================================================
// Analyze Command
// ============================================================================

function analyzeDirectory(targetPath, providers) {
  const exists = dirExists(targetPath);
  const empty = exists ? isDirEmpty(targetPath) : true;
  const items = [];

  const masterSkillVersions = collectSkillVersions();
  const masterCommandVersions = collectCommandVersions();

  // Check provider instruction files
  for (const provider of providers) {
    const filename = PROVIDERS[provider].filename;
    const filePath = path.join(targetPath, filename);
    items.push({
      path: filename,
      status: fileExists(filePath) ? 'present' : 'missing',
      group: 'ai-config',
      provider,
    });
  }

  // Check .mcp.json
  items.push({
    path: '.mcp.json',
    status: fileExists(path.join(targetPath, '.mcp.json')) ? 'present' : 'missing',
    group: 'ai-config',
  });

  // Check skills and agents per selected provider
  for (const provider of providers) {
    const providerDef = PROVIDERS[provider];
    const skillsPath = path.join(targetPath, providerDef.skillsDir);

    for (const [skillName, masterVersion] of Object.entries(masterSkillVersions)) {
      const localSkillPath = path.join(skillsPath, skillName, 'SKILL.md');
      if (fileExists(localSkillPath)) {
        const content = fs.readFileSync(localSkillPath, 'utf-8');
        const localVersion = extractVersion(content);
        const item = {
          path: `${providerDef.skillsDir}/${skillName}`,
          status: 'present',
          localVersion,
          masterVersion,
          match: localVersion === masterVersion,
          group: 'skills-commands',
          provider,
        };
        if (ESSENTIAL_SKILLS.includes(skillName)) item.essential = true;
        items.push(item);
      } else {
        const item = {
          path: `${providerDef.skillsDir}/${skillName}`,
          status: 'missing',
          masterVersion,
          group: 'skills-commands',
          provider,
        };
        if (ESSENTIAL_SKILLS.includes(skillName)) item.essential = true;
        items.push(item);
      }
    }

    // Check agents directory for this provider
    if (providerDef.agentsDir && dirExists(AGENTS_DIR)) {
      const agentsPath = path.join(targetPath, providerDef.agentsDir);
      if (dirExists(agentsPath)) {
        const count = fs.readdirSync(agentsPath).length;
        items.push({ path: providerDef.agentsDir, status: 'present', details: { count }, group: 'skills-commands', provider });
      } else {
        items.push({ path: providerDef.agentsDir, status: 'missing', group: 'skills-commands', provider });
      }
    }
  }

  // Check documentation subdirectories
  const docDirs = [
    'documentation/chores',
    'documentation/chores/completed',
    'documentation/features',
    'documentation/designs',
    'documentation/interactive',
    'documentation/reference',
    'documentation/archive',
    'documentation/temp',
  ];
  for (const dir of docDirs) {
    const fullPath = path.join(targetPath, dir);
    items.push({
      path: dir,
      status: dirExists(fullPath) ? 'present' : 'missing',
      group: 'documentation',
    });
  }

  // Check project management files
  items.push({
    path: 'documentation/kanban.json',
    status: fileExists(path.join(targetPath, 'documentation', 'kanban.json')) ? 'present' : 'missing',
    group: 'project-mgmt',
  });
  items.push({
    path: 'documentation/events.json',
    status: fileExists(path.join(targetPath, 'documentation', 'events.json')) ? 'present' : 'missing',
    group: 'project-mgmt',
  });

  // Check config files
  items.push({
    path: '.gitignore',
    status: fileExists(path.join(targetPath, '.gitignore')) ? 'present' : 'missing',
    group: 'config',
  });
  items.push({
    path: '.git',
    status: dirExists(path.join(targetPath, '.git')) ? 'present' : 'missing',
    group: 'config',
  });

  // Build groups with their items
  const groups = SCAFFOLD_GROUPS.map(g => ({
    id: g.id,
    name: g.name,
    description: g.description,
    items: items.filter(i => i.group === g.id),
  }));

  return { exists, empty, items, groups, providers };
}

function runAnalyze(args) {
  const pathIdx = args.indexOf('--path');
  if (pathIdx === -1 || !args[pathIdx + 1]) {
    console.error('Error: --path is required');
    console.log(ANALYZE_HELP);
    process.exit(1);
  }

  const targetPath = path.resolve(expandTilde(args[pathIdx + 1]));
  const providers = parseProviders(args);
  const report = analyzeDirectory(targetPath, providers);

  if (args.includes('--json')) {
    console.log(JSON.stringify(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

// ============================================================================
// Create Command
// ============================================================================

function runCreate(args) {
  const pathIdx = args.indexOf('--path');
  const nameIdx = args.indexOf('--name');
  const idIdx = args.indexOf('--id');
  const descIdx = args.indexOf('--description');
  const configIdx = args.indexOf('--config');

  if (pathIdx === -1 || !args[pathIdx + 1]) {
    console.error('Error: --path is required');
    console.log(CREATE_HELP);
    process.exit(1);
  }
  if (nameIdx === -1 || !args[nameIdx + 1]) {
    console.error('Error: --name is required');
    console.log(CREATE_HELP);
    process.exit(1);
  }

  const targetPath = path.resolve(expandTilde(args[pathIdx + 1]));
  const projectName = args[nameIdx + 1];
  const projectId = idIdx !== -1 && args[idIdx + 1] ? args[idIdx + 1] : toKebabCase(projectName);
  const description = descIdx !== -1 && args[descIdx + 1] ? args[descIdx + 1] : '';
  const providers = parseProviders(args);

  // Parse config for selective scaffolding
  let config = {};
  if (configIdx !== -1 && args[configIdx + 1]) {
    try {
      config = JSON.parse(args[configIdx + 1]);
    } catch (e) {
      console.error('Error: Invalid JSON in --config');
      process.exit(1);
    }
  }
  const itemActions = config.items || {};

  function shouldProcess(itemPath) {
    const action = itemActions[itemPath];
    if (action === 'skip') return false;
    return true; // 'create' or not specified = do it
  }

  // Warn if global CLIs are not available (CLI-only, goes to stderr)
  try {
    execSync('which sly-kanban', { stdio: 'pipe' });
  } catch {
    console.error("Warning: 'sly-kanban' not found globally. Run setup.sh to install global CLIs.");
  }

  const results = [];
  const now = new Date().toISOString();

  // Detect if this is an existing project (has files/subdirs beyond what we're about to create)
  // An empty or non-existent directory is treated as a new project
  const isExistingProject = dirExists(targetPath) && fs.readdirSync(targetPath).some(entry => {
    // Ignore hidden dirs we may have created and empty dirs
    return !entry.startsWith('.');
  });

  // Step 1: Create target directory
  if (!dirExists(targetPath)) {
    ensureDir(targetPath);
    results.push({ action: 'created', path: targetPath });
  }

  // Step 2: Copy skills and agents from store into each selected provider's directory
  const storeSkills = dirExists(SKILLS_DIR)
    ? fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory())
    : [];
  const processedSkillsDirs = new Set();
  const processedAgentsDirs = new Set();

  for (const provider of providers) {
    const providerDef = PROVIDERS[provider];
    const destSkillsDir = path.join(targetPath, providerDef.skillsDir);

    if (storeSkills.length > 0 && !processedSkillsDirs.has(providerDef.skillsDir)) {
      processedSkillsDirs.add(providerDef.skillsDir);
      let copiedCount = 0;
      let skippedSkills = [];

      for (const skill of storeSkills) {
        const srcSkill = path.join(SKILLS_DIR, skill.name);
        const destSkill = path.join(destSkillsDir, skill.name);
        const skillItemPath = `${providerDef.skillsDir}/${skill.name}`;

        // Check if user explicitly skipped this skill in the review phase
        if (!shouldProcess(skillItemPath)) {
          skippedSkills.push(skill.name);
          continue;
        }

        // Never overwrite existing skills — updates are handled via CLI assets management
        if (dirExists(destSkill)) {
          skippedSkills.push(skill.name);
          continue;
        }

        copyDirRecursive(srcSkill, destSkill);

        // For context-priming in NEW projects only: reset areas to blank slate
        if (skill.name === 'context-priming') {
          const areasDir = path.join(destSkill, 'references', 'areas');
          if (dirExists(areasDir)) {
            const areaFiles = fs.readdirSync(areasDir);
            for (const f of areaFiles) {
              fs.unlinkSync(path.join(areasDir, f));
            }
          }
          const areaIndexPath = path.join(destSkill, 'references', 'area-index.md');
          fs.writeFileSync(areaIndexPath, `# Area Index\n\nUpdated: ${now.split('T')[0]}\n\n## Areas\n\n<!-- Areas will be added during context-priming initialization -->\n`, 'utf-8');
        }

        copiedCount++;
      }
      if (copiedCount > 0) {
        results.push({ action: 'copied', path: providerDef.skillsDir, count: copiedCount, group: 'skills-commands', provider });
      }
      if (skippedSkills.length > 0) {
        results.push({ action: 'skipped', path: `${providerDef.skillsDir} (existing)`, items: skippedSkills, group: 'skills-commands', provider });
      }
    }

    // Copy agents into provider's agents directory
    if (providerDef.agentsDir && shouldProcess(providerDef.agentsDir) && dirExists(AGENTS_DIR) && !processedAgentsDirs.has(providerDef.agentsDir)) {
      processedAgentsDirs.add(providerDef.agentsDir);
      const destAgents = path.join(targetPath, providerDef.agentsDir);
      const skipped = copyDirRecursive(AGENTS_DIR, destAgents);
      const count = fs.readdirSync(AGENTS_DIR).length - skipped.length;
      if (count > 0) {
        results.push({ action: 'copied', path: providerDef.agentsDir, count, group: 'skills-commands', provider });
      }
      if (skipped.length > 0) {
        results.push({ action: 'skipped', path: `${providerDef.agentsDir} (existing)`, count: skipped.length, group: 'skills-commands', provider });
      }
    }
  }

  // Step 3: Write template files
  const skillVersions = collectSkillVersions();
  const commandVersions = collectCommandVersions();
  const templateVars = {
    '{{PROJECT_NAME}}': projectName,
    '{{PROJECT_ID}}': projectId,
    '{{TIMESTAMP}}': now,
    '{{SKILLS_LIST}}': Object.entries(skillVersions).map(([k, v]) => `${k} (${v})`).join(', '),
    '{{COMMANDS_LIST}}': Object.entries(commandVersions).map(([k, v]) => `${k} (${v})`).join(', '),
  };

  // .mcp.json (skip if exists)
  if (shouldProcess('.mcp.json')) {
    const destPath = path.join(targetPath, '.mcp.json');
    if (fs.existsSync(destPath)) {
      results.push({ action: 'skipped', path: '.mcp.json (already exists)', group: 'ai-config' });
    } else {
      const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'mcp.json'), 'utf-8');
      fs.writeFileSync(destPath, tpl, 'utf-8');
      results.push({ action: 'created', path: '.mcp.json', group: 'ai-config' });
    }
  }

  // .gitignore (skip if exists)
  if (shouldProcess('.gitignore')) {
    const destPath = path.join(targetPath, '.gitignore');
    if (fs.existsSync(destPath)) {
      results.push({ action: 'skipped', path: '.gitignore (already exists)', group: 'config' });
    } else {
      const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'gitignore'), 'utf-8');
      fs.writeFileSync(destPath, tpl, 'utf-8');
      results.push({ action: 'created', path: '.gitignore', group: 'config' });
    }
  }

  // Provider instruction files (multi-provider loop)
  for (const provider of providers) {
    const filename = PROVIDERS[provider].filename;
    if (shouldProcess(filename)) {
      const destPath = path.join(targetPath, filename);
      if (fs.existsSync(destPath)) {
        results.push({ action: 'skipped', path: `${filename} (already exists)`, group: 'ai-config', provider });
      } else {
        const content = assembleInstructionFile(provider, templateVars);
        fs.writeFileSync(destPath, content, 'utf-8');
        results.push({ action: 'created', path: filename, group: 'ai-config', provider });
      }
    }
  }

  // Step 4: Create documentation directories (only report what's actually new)
  const docDirs = [
    'documentation/chores/completed',
    'documentation/features',
    'documentation/designs',
    'documentation/interactive',
    'documentation/reference',
    'documentation/archive',
    'documentation/temp',
  ];
  let newDocDirs = 0;
  for (const dir of docDirs) {
    if (shouldProcess(dir)) {
      if (!dirExists(path.join(targetPath, dir))) {
        newDocDirs++;
      }
      ensureDir(path.join(targetPath, dir));
    }
  }
  if (newDocDirs > 0) {
    results.push({ action: 'created', path: `documentation/ (${newDocDirs} new subdirs)`, group: 'documentation' });
  } else {
    results.push({ action: 'skipped', path: 'documentation/ (all exist)', group: 'documentation' });
  }

  // documentation/archive/README.md (skip if exists)
  if (shouldProcess('documentation/archive')) {
    const destPath = path.join(targetPath, 'documentation', 'archive', 'README.md');
    if (!fs.existsSync(destPath)) {
      const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'archive-readme.md'), 'utf-8');
      fs.writeFileSync(destPath, tpl, 'utf-8');
    }
  }

  // Step 5: Create kanban.json with seed cards (skip if exists)
  if (shouldProcess('documentation/kanban.json')) {
    const kanbanPath = path.join(targetPath, 'documentation', 'kanban.json');
    if (fs.existsSync(kanbanPath)) {
      results.push({ action: 'skipped', path: 'documentation/kanban.json (already exists)', group: 'project-mgmt' });
    } else {
      const seedFile = isExistingProject ? 'seed-cards-existing.json' : 'seed-cards-new.json';
      const seedCardsTpl = fs.readFileSync(path.join(TEMPLATES_DIR, seedFile), 'utf-8');
      const seedCards = JSON.parse(replaceTemplateVars(seedCardsTpl, templateVars));

      // Build kanban structure with seed cards in backlog
      const backlogCards = seedCards.map((card, idx) => ({
        id: `card-${Date.now() + idx}`,
        title: card.title,
        description: card.description,
        type: card.type,
        priority: card.priority,
        order: (idx + 1) * 10,
        areas: [],
        tags: [],
        problems: [],
        checklist: [],
        created_at: now,
        updated_at: now,
      }));

      const kanban = {
        project_id: projectId,
        stages: {
          backlog: backlogCards,
          design: [],
          implementation: [],
          testing: [],
          done: [],
        },
        last_updated: now,
      };

      ensureDir(path.join(targetPath, 'documentation'));
      fs.writeFileSync(
        kanbanPath,
        JSON.stringify(kanban, null, 2) + '\n',
        'utf-8'
      );
      results.push({ action: 'created', path: 'documentation/kanban.json', seedCards: seedCards.length, seedType: isExistingProject ? 'existing' : 'new', group: 'project-mgmt' });
    }
  }

  // Step 5b: Create events.json (skip if exists)
  if (shouldProcess('documentation/events.json')) {
    const eventsPath = path.join(targetPath, 'documentation', 'events.json');
    if (fs.existsSync(eventsPath)) {
      results.push({ action: 'skipped', path: 'documentation/events.json (already exists)', group: 'project-mgmt' });
    } else {
      ensureDir(path.join(targetPath, 'documentation'));
      fs.writeFileSync(eventsPath, '[]\n', 'utf-8');
      results.push({ action: 'created', path: 'documentation/events.json', group: 'project-mgmt' });
    }
  }

  // Step 6: git init
  if (shouldProcess('.git') && !dirExists(path.join(targetPath, '.git'))) {
    try {
      execSync('git init', { cwd: targetPath, stdio: 'pipe' });
      results.push({ action: 'initialized', path: '.git', group: 'config' });
    } catch (e) {
      results.push({ action: 'failed', path: '.git', error: e.message, group: 'config' });
    }
  }

  // Output result
  const report = {
    success: true,
    projectId,
    projectName,
    targetPath,
    providers,
    results,
  };

  console.log(JSON.stringify(report, null, 2));
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(MAIN_HELP);
  process.exit(0);
}

switch (command) {
  case 'analyze':
    if (args.includes('--help') || args.includes('-h')) {
      console.log(ANALYZE_HELP);
      process.exit(0);
    }
    runAnalyze(args.slice(1));
    break;

  case 'create':
    if (args.includes('--help') || args.includes('-h')) {
      console.log(CREATE_HELP);
      process.exit(0);
    }
    runCreate(args.slice(1));
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.log(MAIN_HELP);
    process.exit(1);
}
