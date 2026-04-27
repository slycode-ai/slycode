#!/usr/bin/env node

/**
 * Kanban CLI Tool
 *
 * A command-line interface for managing kanban cards.
 * Designed for Claude to programmatically interact with the kanban board.
 *
 * Usage: node scripts/kanban.js <command> [options]
 * Run with --help for more information.
 */

const fs = require('fs');
const path = require('path');

// Configuration
// Resolve project root from cwd (walk up to find documentation/kanban.json)
function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'documentation', 'kanban.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  // No kanban.json found in directory tree — return null so callers can show a clear error
  return null;
}

const PROJECT_ROOT = findProjectRoot();
if (!PROJECT_ROOT) {
  console.error('Error: No kanban board found.');
  console.error(`Searched for documentation/kanban.json in the directory tree above ${process.cwd()}`);
  console.error('Run this command from within a project that has a kanban board.');
  process.exit(1);
}
const PROJECT_NAME = path.basename(PROJECT_ROOT).replace(/[^a-zA-Z0-9-]/g, '-');
const KANBAN_PATH = path.join(PROJECT_ROOT, 'documentation', 'kanban.json');
const EVENTS_PATH = path.join(PROJECT_ROOT, 'documentation', 'events.json');
const AREA_INDEX_PATH = path.join(PROJECT_ROOT, '.claude', 'skills', 'context-priming', 'references', 'area-index.md');
const MAX_EVENTS = 500;

const VALID_STAGES = ['backlog', 'design', 'implementation', 'testing', 'done'];
const VALID_TYPES = ['feature', 'chore', 'bug'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_SEVERITIES = ['minor', 'major', 'critical'];
const STATUS_MAX_GRAPHEMES = 120;

// ============================================================================
// Status helpers — keep behavior identical to web/src/lib/status.ts
// ============================================================================

// Normalize a free-form status string for safe storage:
// - strip ANSI/control/bidi/zero-width
// - collapse whitespace
// - cap at STATUS_MAX_GRAPHEMES
// Returns null if the result is empty (treat as "clear").
function normalizeStatus(input) {
  if (typeof input !== 'string') return null;
  let s = input;
  // ANSI CSI
  s = s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  // ANSI OSC
  s = s.replace(/\x1b\][^\x07]*\x07/g, '');
  s = s.replace(/\x1b./g, '');
  // C0 controls (excluding tab/newline — handled as whitespace below)
  s = s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  // Bidi controls
  s = s.replace(/[‪-‮⁦-⁩]/g, '');
  // Zero-width
  s = s.replace(/[​-‍⁠﻿]/g, '');
  // All whitespace → single space
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // Cap at grapheme clusters when available (Node 16+); else code points
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const graphemes = [];
    for (const g of seg.segment(s)) {
      graphemes.push(g.segment);
      if (graphemes.length > STATUS_MAX_GRAPHEMES) {
        return graphemes.slice(0, STATUS_MAX_GRAPHEMES).join('');
      }
    }
    return s;
  }
  const cps = Array.from(s);
  return cps.length > STATUS_MAX_GRAPHEMES ? cps.slice(0, STATUS_MAX_GRAPHEMES).join('') : s;
}

// Defensive read — accepts anything (legacy string, undefined, malformed object) and
// returns a CardStatus or null.
function readStatus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.text !== 'string' || typeof raw.setAt !== 'string') return null;
  if (!raw.text.trim()) return null;
  return { text: raw.text, setAt: raw.setAt };
}

function formatRelativeTimeStatus(pastIso, now = new Date()) {
  const past = new Date(pastIso);
  if (isNaN(past.getTime())) return '';
  const diffMs = now.getTime() - past.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function getStatusAgeLabelCli(status, now = new Date()) {
  const past = new Date(status.setAt);
  if (isNaN(past.getTime())) return status.setAt;
  const pad = (n) => String(n).padStart(2, '0');
  const abs = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())} ${pad(past.getHours())}:${pad(past.getMinutes())}`;
  return `${abs} · ${formatRelativeTimeStatus(status.setAt, now)}`;
}

// For prompt-bound surfaces. Renders status as quoted untrusted card metadata.
function formatStatusForPromptCli(status, now = new Date()) {
  if (!status) return [];
  const safe = String(status.text).replace(/[\r\n]+/g, ' ').replace(/"/g, "'");
  return [
    `Status (untrusted card metadata): "${safe}"`,
    `Status set: ${getStatusAgeLabelCli(status, now)}`,
  ];
}

// ============================================================================
// Help Text
// ============================================================================

const MAIN_HELP = `
Usage: kanban <command> [options]

Commands:
  search     Search cards by query, stage, type, or area
  show       Show full details of a card by ID
  board      Show full board snapshot (all cards grouped by stage)
  create     Create a new card (use --automation for automation cards)
  update     Update card fields (title, description, areas, etc.)
  move       Move a card to a different stage
  reorder    Reorder cards within a stage
  archive    Archive cards (soft delete)
  checklist  Manage checklist items
  problem    Manage problems/issues
  notes      Manage cross-agent notes
  status     Get/set/clear a short progress status visible on the card
  automation Manage card automations (scheduled prompt execution)
  prompt     Send a prompt to another card's session (cross-card execution)
  respond    Reply to a cross-card prompt (callback for --wait mode)
  areas      List available areas from context-priming

Run 'kanban <command> --help' for command-specific options.
`;

const SEARCH_HELP = `
Usage: kanban search [query] [options]

Search for cards matching criteria.

Options:
  --stage <stage>       Filter by stage (backlog|design|implementation|testing|done)
  --type <type>         Filter by type (feature|chore|bug)
  --area <area>         Filter by area
  --limit <n>           Max results to show (default: 100)
  --archived            Show only archived cards
  --include-archived    Include archived cards in results

Examples:
  kanban search "terminal"
  kanban search --stage backlog --type feature
  kanban search --area web-frontend
  kanban search --archived
`;

const SHOW_HELP = `
Usage: kanban show <card-id> [options]

Show full details of a card.

Options:
  --include-archived    Show card even if archived

Examples:
  kanban show card-123
  kanban show bridge-001
`;

const CREATE_HELP = `
Usage: kanban create [options]

Create a new card.

Options:
  --title <title>        Card title (required)
  --description <desc>   Card description
  --type <type>          Card type: feature|chore|bug (default: feature)
  --priority <priority>  Priority: low|medium|high|critical (default: medium)
  --stage <stage>        Initial stage (default: backlog)
  --areas <areas>        Areas (comma-separated)

Examples:
  kanban create --title "Add user authentication"
  kanban create --title "Fix login bug" --type bug --priority high
  kanban create --title "Refactor database layer" --type chore --areas "backend,database"
`;

const UPDATE_HELP = `
Usage: kanban update <card-id> [options]

Update card fields.

Options:
  --title <title>        Set title
  --description <desc>   Set description
  --type <type>          Set type (feature|chore|bug)
  --priority <priority>  Set priority (low|medium|high|critical)
  --areas <areas>        Set areas (comma-separated)
  --tags <tags>          Set tags (comma-separated)
  --design-ref <path>    Set design document reference (pass "" to clear)
  --feature-ref <path>   Set feature spec reference (pass "" to clear)
  --test-ref <path>      Set test document reference (pass "" to clear)
  --html-ref <path>      Set HTML attachment reference (pass "" to clear)
  --status <text>        Set progress status (max 120 chars; pass "" to clear)

Examples:
  kanban update card-123 --title "New title" --priority high
  kanban update card-123 --areas "web-frontend,terminal-bridge"
  kanban update card-123 --html-ref "documentation/designs/foo.html"
  kanban update card-123 --html-ref ""    # clear an existing HTML ref
  kanban update card-123 --status "Refactoring auth path"
`;

const MOVE_HELP = `
Usage: kanban move <card-id> <stage>

Move a card to a different stage.

Stages: backlog, design, implementation, testing, done

Note: moving a card to a different stage clears the card's status. If you
want a status to remain after a stage transition, set the status AFTER
the move, not before.

Examples:
  kanban move card-123 design
  kanban move bridge-001 done
`;

const STATUS_HELP = `
Usage: kanban status <card-id>                 (print current status)
       kanban status <card-id> "<text>"        (set status)
       kanban status <card-id> --clear         (clear status)
       kanban status <card-id> ""              (clear status — empty arg)

Set, get, or clear the short AI-readable progress status displayed on
the card. Status is auto-cleared when the card moves to a different
stage. To carry a status across a stage transition, set it AFTER the
move.

Status text is normalized at write time (whitespace collapsed, control
characters stripped) and capped at 120 grapheme clusters.

Examples:
  kanban status card-123
  kanban status card-123 "Finished design — ready to implement"
  kanban status card-123 --clear
`;

const ARCHIVE_HELP = `
Usage: kanban archive <card-id>
       kanban archive <card-id> --undo
       kanban archive --all [--before <days>]

Archive cards (soft delete) or restore archived cards.

Options:
  --all               Archive all cards in done stage
  --before <days>     Only archive done cards older than N days
  --undo              Unarchive a card (restore from archive)

Examples:
  kanban archive card-123
  kanban archive card-123 --undo
  kanban archive --all
  kanban archive --all --before 30
`;

const CHECKLIST_HELP = `
Usage: kanban checklist <card-id> <action> [options]

Manage checklist items.

Actions:
  list                 List all checklist items
  add <text>           Add new item
  toggle <item-id>     Toggle done status
  remove <item-id>     Remove item

Examples:
  kanban checklist card-123 list
  kanban checklist card-123 add "Write unit tests"
  kanban checklist card-123 toggle check-1
  kanban checklist card-123 remove check-1
`;

const PROBLEM_HELP = `
Usage: kanban problem <card-id> <action> [options]

Manage problems/issues on a card.

Actions:
  list                  List all problems
  add <description>     Add new problem
  resolve <problem-id>  Mark problem as resolved
  promote <problem-id>  Create backlog card from problem and resolve it

Options:
  --severity <level>    Severity for new problem: minor|major|critical (default: minor)
  --type <type>         Type for promoted card: feature|chore|bug (default: bug)
  --priority <priority> Priority for promoted card: low|medium|high|critical (default based on severity)

Examples:
  kanban problem card-123 list
  kanban problem card-123 add "Auth fails on refresh" --severity major
  kanban problem card-123 resolve prob-1
  kanban problem card-123 promote prob-1 --type chore
`;

const NOTES_HELP = `
Usage: kanban notes <card-id> <action> [options]

Manage cross-agent notes on a card.

Actions:
  list                           List all notes
  add <text>                     Add a new note
  oldest [N]                     Show oldest N notes (default: 20)
  summarize <text> [--count N]   Replace oldest N notes with a summary note
  search <query>                 Search notes by text
  edit <note-id> <text>          Edit an existing note
  delete <note-id>               Delete a note
  clear                          Remove all notes

Options:
  --agent <name>        Agent name for new/summary notes (e.g. "Claude", "Codex", "Gemini")
  --count <N>           Number of oldest notes to summarize (default: 20)

Examples:
  kanban notes card-123 list
  kanban notes card-123 add "API expects POST with { cardId }" --agent "Claude"
  kanban notes card-123 oldest 20
  kanban notes card-123 summarize "Summary of early notes: ..." --count 20 --agent "Claude"
  kanban notes card-123 search "blocker"
  kanban notes card-123 edit 2 "Updated note text"
  kanban notes card-123 delete 3
  kanban notes card-123 clear
`;

const AUTOMATION_HELP = `
Usage: kanban automation <subcommand> [options]

Manage card automations (scheduled execution using card description as prompt).

Subcommands:
  configure <card-id>   Create or update automation config on a card
  enable <card-id>      Enable the automation
  disable <card-id>     Disable the automation
  run <card-id>         Manual trigger (calls bridge API to start session with card description)
  status <card-id>      Show full automation config and run state
  list                  List all automation cards

Configure options:
  --schedule <cron|iso>       Cron expression or ISO datetime
  --schedule-type <type>      "recurring" or "one-shot" (default: recurring)
  --provider <id>             Provider ID (claude, codex, gemini)
  --fresh-session <bool>      Kill and recreate session each run (default: false)
  --working-dir <path>        Override working directory
  --report-messaging <bool>   Auto-append messaging instructions (default: false)

List options:
  --tag <tag>           Filter by tag

Note: The card description is used as the automation prompt. Edit the card description to change what the automation does.

Examples:
  kanban automation configure card-123 --schedule "0 6 * * *" --provider claude
  kanban automation configure card-123 --schedule "2026-03-01T09:00:00" --schedule-type one-shot
  kanban automation enable card-123
  kanban automation disable card-123
  kanban automation run card-123
  kanban automation status card-123
  kanban automation list
  kanban automation list --tag deploy
`;

const AREAS_HELP = `
Usage: kanban areas

List available areas from context-priming area-index.md.
These are valid values for the --areas option.
`;

const PROMPT_HELP = `
Usage: kanban prompt <card-id> "prompt text" [options]

Send a prompt to another card's session (cross-card execution).
If no running session exists, one is created automatically.

Options:
  --provider <id>     Target provider (claude|codex|gemini). Default: stage default
  --model <id>        Model for new sessions (e.g. opus, o3)
  --wait              Wait for a response (sync mode with callback)
  --timeout <secs>    Timeout for --wait mode (default: 120 seconds)
  --force             Bypass session lock and busy checks
  --fresh             Stop any existing session and start a clean one

Modes:
  Fire-and-forget:  kanban prompt <card-id> "do something"
  Wait for response: kanban prompt <card-id> "analyze this" --wait --timeout 60
  Fresh session:     kanban prompt <card-id> "review" --fresh --provider codex --wait

When using --wait, the called card must run 'kanban respond <id> "response"' to return data.
`;

const RESPOND_HELP = `
Usage:
  kanban respond <response-id> "response data"
  kanban respond <response-id> --stdin <<'EOF'
  ...response text...
  EOF
  cat response.txt | kanban respond <response-id>

Reply to a cross-card prompt that used --wait mode.
The response-id is provided in the callback instruction appended to the prompt.

Input modes (choose ONE):
  positional            Pass the response as a quoted argument. Suitable for
                        short, single-line replies without backticks, $(...),
                        backslashes, or embedded quotes — those characters are
                        mangled by the shell before this CLI sees them.
  --stdin               Read the payload from stdin. Recommended for any
                        non-trivial reply. Combine with a single-quoted heredoc
                        to bypass shell quoting entirely.
  (auto)                If no positional payload is given and stdin is piped
                        or redirected, stdin is read automatically.

Diagnostics:
  On success the CLI prints:  Response delivered. (NN bytes — preview: "...")
  Use the byte count and preview to confirm the right bytes were delivered.

Limits:
  Payload must be non-empty. Maximum size is 1 MB.

Examples:
  kanban respond abc-123 "Analysis complete. Found 3 issues."
  kanban respond abc-123 --stdin <<'EOF'
  Multi-line response with \`backticks\`, $(safe), and "quotes".
  EOF
  cat reply.txt | kanban respond abc-123
`;

const BOARD_HELP = `
Usage: kanban board [options]

Show full board snapshot — all cards with complete details, grouped by stage.

Default: shows backlog, design, implementation, testing. Excludes done and automation cards.

Options:
  --all                Include done cards
  --stages <list>      Filter to specific stages (comma-separated)
  --inflight           Show only design, implementation, testing (excludes backlog)
  --compact            Summary output — one line per card (ID, priority, title)

Examples:
  kanban board
  kanban board --compact
  kanban board --all
  kanban board --stages backlog,design
  kanban board --inflight
`;

const REORDER_HELP = `
Usage: kanban reorder <stage> [card-ids...]
       kanban reorder <stage> --top <card-id>
       kanban reorder <stage> --bottom <card-id>
       kanban reorder <stage> --position <n> <card-id>

Reorder cards within a stage by setting the order field.

Full reorder: list card IDs in priority order. Listed cards get order 10, 20, 30...
Unlisted cards in the stage keep relative order but sort after listed cards.

Options:
  --top <card-id>          Move card to first position
  --bottom <card-id>       Move card to last position
  --position <n> <card-id> Move card to position N (1-indexed)

Examples:
  kanban reorder backlog card-1 card-2 card-3
  kanban reorder backlog --top card-2
  kanban reorder backlog --bottom card-5
  kanban reorder implementation --position 2 card-7
`;

// ============================================================================
// Utility Functions
// ============================================================================

function readKanban() {
  try {
    const content = fs.readFileSync(KANBAN_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('Error: kanban.json not found at', KANBAN_PATH);
    } else if (err instanceof SyntaxError) {
      console.error('Error: kanban.json contains invalid JSON');
    } else {
      console.error('Error reading kanban.json:', err.message);
    }
    process.exit(1);
  }
}

function writeKanban(data) {
  data.last_updated = new Date().toISOString();
  try {
    fs.writeFileSync(KANBAN_PATH, JSON.stringify(data, null, 2) + '\n');
  } catch (err) {
    console.error('Error writing kanban.json:', err.message);
    process.exit(1);
  }
}

function findCard(kanban, cardId, includeArchived = false) {
  // First try exact ID match
  for (const stage of VALID_STAGES) {
    const cards = kanban.stages[stage] || [];
    const card = cards.find(c => c.id === cardId);
    if (card) {
      if (card.archived && !includeArchived) {
        return null;
      }
      return { card, stage };
    }
  }

  // Fall back to exact title match (case-insensitive, non-archived only)
  const titleLower = cardId.toLowerCase();
  for (const stage of VALID_STAGES) {
    const cards = kanban.stages[stage] || [];
    const card = cards.find(c => !c.archived && c.title && c.title.toLowerCase() === titleLower);
    if (card) {
      return { card, stage };
    }
  }

  return null;
}

function getAllCards(kanban, includeArchived = false) {
  const cards = [];
  for (const stage of VALID_STAGES) {
    for (const card of (kanban.stages[stage] || [])) {
      if (!card.archived || includeArchived) {
        cards.push({ card, stage });
      }
    }
  }
  return cards;
}

/**
 * Backfill sequential card numbers for cards that don't have one.
 * Sorts all cards by created_at ascending and assigns numbers starting from 1.
 * Sets kanban.nextCardNumber to the next available number.
 */
function backfillCardNumbers(kanban) {
  const allCards = getAllCards(kanban, true); // include archived
  // Sort by created_at ascending
  allCards.sort((a, b) => new Date(a.card.created_at) - new Date(b.card.created_at));
  let maxNumber = 0;
  // First pass: find highest existing number
  for (const { card } of allCards) {
    if (card.number != null && card.number > maxNumber) {
      maxNumber = card.number;
    }
  }
  // Second pass: assign numbers to cards without one
  let nextNum = maxNumber + 1;
  // Sort unnumbered cards by created_at, assign sequentially
  const unnumbered = allCards.filter(({ card }) => card.number == null);
  // If no cards have numbers yet, start from 1
  if (maxNumber === 0) {
    allCards.forEach(({ card }, index) => {
      card.number = index + 1;
    });
    kanban.nextCardNumber = allCards.length + 1;
  } else {
    // Only backfill unnumbered cards
    for (const { card } of unnumbered) {
      card.number = nextNum++;
    }
    kanban.nextCardNumber = nextNum;
  }
}

/**
 * Ensure kanban has sequential card numbers. Auto-backfills on first run.
 */
function ensureCardNumbers(kanban) {
  if (kanban.nextCardNumber == null) {
    backfillCardNumbers(kanban);
  }
}

function generateId(prefix = 'card') {
  return `${prefix}-${Date.now()}`;
}

/**
 * Append an event to the activity log.
 * Silent — never throws, never blocks card operations.
 */
function emitEvent(type, project, detail, cardId) {
  try {
    let events = [];
    if (fs.existsSync(EVENTS_PATH)) {
      events = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf-8'));
      if (!Array.isArray(events)) events = [];
    }
    const event = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      project: project || PROJECT_NAME,
      detail,
      source: 'cli',
      timestamp: new Date().toISOString(),
    };
    if (cardId) event.card = cardId;
    events.push(event);
    if (events.length > MAX_EVENTS) {
      events.splice(0, events.length - MAX_EVENTS);
    }
    fs.writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2));
  } catch {
    // Never fail card operations due to event logging
  }
}

function parseArgs(args) {
  const result = { _: [] };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith('--')) {
        result[key] = nextArg;
        i += 2;
      } else {
        result[key] = true;
        i += 1;
      }
    } else {
      result._.push(arg);
      i += 1;
    }
  }
  return result;
}

function formatCard(card, stage, verbose = false) {
  const archived = card.archived ? ' [ARCHIVED]' : '';
  if (verbose) {
    const cardNum = card.number != null ? ` (#${String(card.number).padStart(card.number > 9999 ? 0 : 4, '0')})` : '';
    let output = `
ID: ${card.id}${cardNum}${archived}
Title: ${card.title}
Stage: ${stage}
Type: ${card.type}
Priority: ${card.priority}
`;
    if (card.description) {
      output += `Description: ${card.description}\n`;
    }
    if (card.areas && card.areas.length > 0) {
      output += `Areas: ${card.areas.join(', ')}\n`;
    }
    if (card.tags && card.tags.length > 0) {
      output += `Tags: ${card.tags.join(', ')}\n`;
    }
    if (card.design_ref) {
      output += `Design Doc: ${card.design_ref}\n`;
    }
    if (card.feature_ref) {
      output += `Feature Spec: ${card.feature_ref}\n`;
    }
    if (card.test_ref) {
      output += `Test Doc: ${card.test_ref}\n`;
    }
    if (card.html_ref) {
      output += `HTML: ${card.html_ref}\n`;
    }
    {
      const statusObj = readStatus(card.status);
      if (statusObj) {
        output += `Status: ${statusObj.text} (${formatRelativeTimeStatus(statusObj.setAt)})\n`;
      }
    }
    if (card.automation) {
      const auto = card.automation;
      output += `\nAutomation: ${auto.enabled ? 'ENABLED' : 'DISABLED'}\n`;
      output += `  Schedule: ${auto.schedule || '(not set)'} (${auto.scheduleType})\n`;
      output += `  Provider: ${auto.provider}\n`;
      output += `  Fresh Session: ${auto.freshSession}\n`;
      if (auto.workingDirectory) output += `  Working Dir: ${auto.workingDirectory}\n`;
      output += `  Report via Messaging: ${auto.reportViaMessaging}\n`;
      output += `  Last Run: ${auto.lastRun || 'never'}${auto.lastResult ? ` (${auto.lastResult})` : ''}\n`;
      if (auto.nextRun) output += `  Next Run: ${auto.nextRun}\n`;
    }
    if (card.checklist && card.checklist.length > 0) {
      output += `\nChecklist:\n`;
      for (const item of card.checklist) {
        const status = item.done ? '[x]' : '[ ]';
        output += `  ${status} ${item.text} (${item.id})\n`;
      }
    }
    if (card.problems && card.problems.length > 0) {
      output += `\nProblems:\n`;
      for (const prob of card.problems) {
        const status = prob.resolved_at ? '[RESOLVED]' : `[${prob.severity.toUpperCase()}]`;
        output += `  ${status} ${prob.description} (${prob.id})\n`;
      }
    }
    if (card.agentNotes && card.agentNotes.length > 0) {
      output += `\nAgent Notes (${card.agentNotes.length}):\n`;
      for (const note of card.agentNotes) {
        const agent = note.agent ? `  ${note.agent}` : '';
        const ts = note.timestamp ? note.timestamp.replace('T', ' ').slice(0, 16) : '';
        output += `  #${note.id}  [${ts}]${agent}\n      ${note.text}\n`;
      }
    }
    output += `\nCreated: ${card.created_at}`;
    output += `\nUpdated: ${card.updated_at}`;
    return output;
  } else {
    const displayStage = card.automation ? 'automation' : stage;
    return `${card.id}${archived}\t${displayStage}\t${card.type}\t${card.priority}\t${card.title}`;
  }
}

// ============================================================================
// Commands
// ============================================================================

function cmdSearch(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(SEARCH_HELP);
    return;
  }

  const query = opts._.join(' ').toLowerCase();
  const kanban = readKanban();

  const showOnlyArchived = opts.archived === true;
  const includeArchived = opts['include-archived'] === true || showOnlyArchived;

  let results = getAllCards(kanban, includeArchived);

  // Filter by archived status
  if (showOnlyArchived) {
    results = results.filter(({ card }) => card.archived);
  }

  // Exclude automation cards from bare searches (no query), but include them when searching by name
  if (!opts.automation && !query) {
    results = results.filter(({ card }) => !card.automation);
  }

  // Filter by stage
  if (opts.stage) {
    if (!VALID_STAGES.includes(opts.stage)) {
      console.error(`Error: Invalid stage '${opts.stage}'. Valid: ${VALID_STAGES.join(', ')}`);
      process.exit(1);
    }
    results = results.filter(({ stage }) => stage === opts.stage);
  }

  // Filter by type
  if (opts.type) {
    if (!VALID_TYPES.includes(opts.type)) {
      console.error(`Error: Invalid type '${opts.type}'. Valid: ${VALID_TYPES.join(', ')}`);
      process.exit(1);
    }
    results = results.filter(({ card }) => card.type === opts.type);
  }

  // Filter by area
  if (opts.area) {
    results = results.filter(({ card }) => card.areas && card.areas.includes(opts.area));
  }

  // Filter by query
  if (query) {
    results = results.filter(({ card }) =>
      card.title.toLowerCase().includes(query) ||
      (card.description && card.description.toLowerCase().includes(query))
    );
  }

  // Apply limit
  const limit = parseInt(opts.limit) || 100;
  const totalFound = results.length;
  results = results.slice(0, limit);

  if (results.length === 0) {
    console.log('No cards found matching criteria.');
    return;
  }

  const truncated = totalFound > limit;
  console.log(`Found ${totalFound} card(s)${truncated ? ` (showing first ${limit})` : ''}:\n`);
  console.log('ID\tStage\tType\tPriority\tTitle');
  console.log('-'.repeat(80));
  for (const { card, stage } of results) {
    console.log(formatCard(card, stage));
  }
}

function cmdShow(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(SHOW_HELP);
    return;
  }

  const cardId = opts._[0];
  if (!cardId) {
    console.error('Error: Card ID required');
    console.log(SHOW_HELP);
    process.exit(1);
  }

  const kanban = readKanban();
  const includeArchived = opts['include-archived'] === true;
  const result = findCard(kanban, cardId, includeArchived);

  if (!result) {
    console.error(`Error: Card '${cardId}' not found${includeArchived ? '' : ' (use --include-archived to see archived cards)'}`);
    process.exit(1);
  }

  console.log(formatCard(result.card, result.stage, true));
}

function cmdCreate(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(CREATE_HELP);
    return;
  }

  if (!opts.title) {
    console.error('Error: --title is required');
    console.log(CREATE_HELP);
    process.exit(1);
  }

  const cardType = opts.type || 'feature';
  if (!VALID_TYPES.includes(cardType)) {
    console.error(`Error: Invalid type '${cardType}'. Valid: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  const priority = opts.priority || 'medium';
  if (!VALID_PRIORITIES.includes(priority)) {
    console.error(`Error: Invalid priority '${priority}'. Valid: ${VALID_PRIORITIES.join(', ')}`);
    process.exit(1);
  }

  const stage = opts.stage || 'backlog';
  if (!VALID_STAGES.includes(stage)) {
    console.error(`Error: Invalid stage '${stage}'. Valid: ${VALID_STAGES.join(', ')}`);
    process.exit(1);
  }

  const kanban = readKanban();
  ensureCardNumbers(kanban);
  const stageCards = kanban.stages[stage] || [];

  // Calculate order (append to end)
  const maxOrder = stageCards.reduce((max, c) => Math.max(max, c.order || 0), 0);

  const now = new Date().toISOString();
  const cardNumber = kanban.nextCardNumber;
  kanban.nextCardNumber = cardNumber + 1;

  const newCard = {
    id: generateId('card'),
    number: cardNumber,
    title: opts.title,
    description: opts.description || '',
    type: cardType,
    priority: priority,
    order: maxOrder + 10,
    areas: opts.areas ? opts.areas.split(',').map(a => a.trim()) : [],
    tags: [],
    problems: [],
    checklist: [],
    created_at: now,
    updated_at: now,
    last_modified_by: 'cli',
  };

  if (opts.automation) {
    newCard.automation = {
      enabled: false,
      schedule: '',
      scheduleType: 'recurring',
      provider: 'claude',
      freshSession: false,
      reportViaMessaging: false,
    };
  }

  kanban.stages[stage].push(newCard);
  writeKanban(kanban);
  emitEvent('card_created', PROJECT_NAME, `Card '${newCard.title}' created in ${stage}`, newCard.id);

  console.log(`Created card: ${newCard.id}`);
  console.log(`  Title: ${newCard.title}`);
  console.log(`  Stage: ${stage}`);
  console.log(`  Type: ${newCard.type}`);
  console.log(`  Priority: ${newCard.priority}`);
  if (newCard.areas.length > 0) {
    console.log(`  Areas: ${newCard.areas.join(', ')}`);
  }
}

function cmdUpdate(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(UPDATE_HELP);
    return;
  }

  const cardId = opts._[0];
  if (!cardId) {
    console.error('Error: Card ID required');
    console.log(UPDATE_HELP);
    process.exit(1);
  }

  const kanban = readKanban();
  const result = findCard(kanban, cardId, true);

  if (!result) {
    console.error(`Error: Card '${cardId}' not found`);
    process.exit(1);
  }

  const { card, stage } = result;
  const updates = [];

  if (opts.title) {
    card.title = opts.title;
    updates.push(`title: "${opts.title}"`);
  }

  if (opts.description !== undefined) {
    card.description = opts.description;
    updates.push(`description updated`);
  }

  if (opts.type) {
    if (!VALID_TYPES.includes(opts.type)) {
      console.error(`Error: Invalid type '${opts.type}'. Valid: ${VALID_TYPES.join(', ')}`);
      process.exit(1);
    }
    card.type = opts.type;
    updates.push(`type: ${opts.type}`);
  }

  if (opts.priority) {
    if (!VALID_PRIORITIES.includes(opts.priority)) {
      console.error(`Error: Invalid priority '${opts.priority}'. Valid: ${VALID_PRIORITIES.join(', ')}`);
      process.exit(1);
    }
    card.priority = opts.priority;
    updates.push(`priority: ${opts.priority}`);
  }

  if (opts.areas) {
    card.areas = opts.areas.split(',').map(a => a.trim());
    updates.push(`areas: ${card.areas.join(', ')}`);
  }

  if (opts.tags) {
    card.tags = opts.tags.split(',').map(t => t.trim());
    updates.push(`tags: ${card.tags.join(', ')}`);
  }

  const applyRefFlag = (flagKey, fieldKey, label, validateExt) => {
    if (!(flagKey in opts)) return;
    const value = opts[flagKey];
    if (value === '' || value === true) {
      // Empty string (or bare flag) clears the field
      if (card[fieldKey]) {
        delete card[fieldKey];
        updates.push(`${fieldKey}: (cleared)`);
      }
      return;
    }
    if (validateExt && !validateExt(value)) {
      console.error(`Warning: ${label} expected file extension not matched (got "${value}"). Setting anyway — server will reject if invalid.`);
    }
    card[fieldKey] = value;
    updates.push(`${fieldKey}: ${value}`);
  };

  applyRefFlag('design-ref', 'design_ref', '--design-ref');
  applyRefFlag('feature-ref', 'feature_ref', '--feature-ref');
  applyRefFlag('test-ref', 'test_ref', '--test-ref');
  applyRefFlag('html-ref', 'html_ref', '--html-ref', (v) => /\.(html|htm)$/i.test(v));

  if ('status' in opts) {
    const value = opts.status;
    if (value === '' || value === true) {
      if (card.status) {
        delete card.status;
        updates.push('status: (cleared)');
      }
    } else {
      const normalized = normalizeStatus(String(value));
      if (!normalized) {
        if (card.status) {
          delete card.status;
          updates.push('status: (cleared — empty after normalization)');
        }
      } else {
        card.status = { text: normalized, setAt: new Date().toISOString() };
        updates.push(`status: "${normalized}"`);
      }
    }
  }

  if (opts.automation !== undefined) {
    if (opts.automation === 'true' || opts.automation === true) {
      if (!card.automation) {
        card.automation = {
          enabled: false,
          schedule: '',
          scheduleType: 'recurring',
          provider: 'claude',
          freshSession: false,
          reportViaMessaging: false,
        };
      }
      updates.push('automation: enabled');
    } else if (opts.automation === 'false') {
      delete card.automation;
      updates.push('automation: removed');
    }
  }

  if (updates.length === 0) {
    console.log('No updates specified. Use --help for options.');
    return;
  }

  card.updated_at = new Date().toISOString();
  card.last_modified_by = 'cli';
  writeKanban(kanban);
  emitEvent('card_updated', PROJECT_NAME, `Card '${card.title}' updated: ${updates.join(', ')}`, cardId);

  console.log(`Updated card: ${cardId}`);
  for (const update of updates) {
    console.log(`  ${update}`);
  }
}

function cmdMove(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(MOVE_HELP);
    return;
  }

  const cardId = opts._[0];
  const newStage = opts._[1];

  if (!cardId || !newStage) {
    console.error('Error: Card ID and stage required');
    console.log(MOVE_HELP);
    process.exit(1);
  }

  if (!VALID_STAGES.includes(newStage)) {
    console.error(`Error: Invalid stage '${newStage}'. Valid: ${VALID_STAGES.join(', ')}`);
    process.exit(1);
  }

  const kanban = readKanban();
  const result = findCard(kanban, cardId, true);

  if (!result) {
    console.error(`Error: Card '${cardId}' not found`);
    process.exit(1);
  }

  const { card, stage: oldStage } = result;

  if (oldStage === newStage) {
    console.log(`Card '${cardId}' is already in ${newStage}`);
    return;
  }

  // Remove from old stage
  kanban.stages[oldStage] = kanban.stages[oldStage].filter(c => c.id !== cardId);

  // Add to new stage (at end)
  const newStageCards = kanban.stages[newStage] || [];
  const maxOrder = newStageCards.reduce((max, c) => Math.max(max, c.order || 0), 0);
  card.order = maxOrder + 10;
  card.updated_at = new Date().toISOString();
  card.last_modified_by = 'cli';
  // Auto-clear status on stage move — status reflects within-stage progress.
  // To carry a status across a transition, set it AFTER the move.
  let clearedStatus = false;
  if (card.status) {
    delete card.status;
    clearedStatus = true;
  }
  kanban.stages[newStage].push(card);

  writeKanban(kanban);
  emitEvent('card_moved', PROJECT_NAME, `Card '${card.title}' moved from ${oldStage} to ${newStage}`, cardId);

  console.log(`Moved card: ${cardId}`);
  console.log(`  From: ${oldStage}`);
  console.log(`  To: ${newStage}`);
  if (clearedStatus) {
    console.log(`  Status: (cleared on stage move)`);
  }
}

function cmdStatus(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(STATUS_HELP);
    return;
  }

  const cardId = opts._[0];
  if (!cardId) {
    console.error('Error: Card ID required');
    console.log(STATUS_HELP);
    process.exit(1);
  }

  const positionalText = opts._[1];
  const explicitClear = opts.clear === true;

  const kanban = readKanban();
  const result = findCard(kanban, cardId, true);
  if (!result) {
    console.error(`Error: Card '${cardId}' not found`);
    process.exit(1);
  }
  const { card } = result;

  // Pure getter: no positional value and no --clear
  if (positionalText === undefined && !explicitClear) {
    const statusObj = readStatus(card.status);
    if (!statusObj) {
      console.log('(no status set)');
      return;
    }
    console.log(`Status: ${statusObj.text}`);
    console.log(`Set:    ${getStatusAgeLabelCli(statusObj)}`);
    return;
  }

  // Clear paths: --clear or empty-string positional
  if (explicitClear || positionalText === '') {
    if (!card.status) {
      console.log(`Status on card '${cardId}' is already clear.`);
      return;
    }
    delete card.status;
    card.updated_at = new Date().toISOString();
    card.last_modified_by = 'cli';
    writeKanban(kanban);
    emitEvent('card_updated', PROJECT_NAME, `Card '${card.title}' status cleared`, cardId);
    console.log(`Cleared status on card: ${cardId}`);
    return;
  }

  // Set path
  const normalized = normalizeStatus(String(positionalText));
  if (!normalized) {
    // Empty after normalization → also a clear
    if (card.status) {
      delete card.status;
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      emitEvent('card_updated', PROJECT_NAME, `Card '${card.title}' status cleared`, cardId);
      console.log(`Cleared status on card: ${cardId} (input was empty after normalization)`);
    } else {
      console.log('(input was empty after normalization; no status set)');
    }
    return;
  }

  card.status = { text: normalized, setAt: new Date().toISOString() };
  card.updated_at = new Date().toISOString();
  card.last_modified_by = 'cli';
  writeKanban(kanban);
  emitEvent('card_updated', PROJECT_NAME, `Card '${card.title}' status set: ${normalized}`, cardId);

  console.log(`Set status on card: ${cardId}`);
  console.log(`  "${normalized}"`);
  if (normalized !== positionalText) {
    console.log(`  (note: text was normalized — leading/trailing/internal whitespace + control chars stripped)`);
  }
}

function cmdArchive(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(ARCHIVE_HELP);
    return;
  }

  const kanban = readKanban();

  if (opts.all && opts.undo) {
    console.error('Error: --undo is not supported with --all. Unarchive cards one at a time.');
    process.exit(1);
  }

  if (opts.all) {
    // Archive all done cards
    const beforeDays = parseInt(opts.before) || 0;
    const cutoff = beforeDays > 0
      ? new Date(Date.now() - beforeDays * 24 * 60 * 60 * 1000)
      : null;

    let count = 0;
    let skippedAutomations = 0;
    for (const card of kanban.stages.done || []) {
      if (card.archived) continue;
      if (card.automation) { skippedAutomations++; continue; }

      if (cutoff) {
        const cardDate = new Date(card.updated_at);
        if (cardDate > cutoff) continue;
      }

      card.archived = true;
      // Don't bump updated_at — archiving is a status change, not a content change
      card.last_modified_by = 'cli';
      count++;
    }

    if (count === 0) {
      console.log('No cards to archive.');
      return;
    }

    writeKanban(kanban);
    emitEvent('card_updated', PROJECT_NAME, `Archived ${count} card(s) from done stage`);
    console.log(`Archived ${count} card(s) from done stage.`);
    if (skippedAutomations > 0) {
      console.log(`Skipped ${skippedAutomations} automation card(s) — automation cards cannot be archived.`);
    }

  } else {
    // Archive specific card
    const cardId = opts._[0];
    if (!cardId) {
      console.error('Error: Card ID required (or use --all)');
      console.log(ARCHIVE_HELP);
      process.exit(1);
    }

    const result = findCard(kanban, cardId, true);
    if (!result) {
      console.error(`Error: Card '${cardId}' not found`);
      process.exit(1);
    }

    const { card, stage } = result;

    if (opts.undo) {
      if (!card.archived) {
        console.log(`Card '${cardId}' is not archived.`);
        return;
      }

      card.archived = false;
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      emitEvent('card_updated', PROJECT_NAME, `Card '${card.title}' unarchived`, cardId);

      console.log(`Unarchived card: ${cardId}`);
      console.log(`  Stage: ${stage}`);
      console.log(`  Title: ${card.title}`);
      return;
    }

    if (card.archived) {
      console.log(`Card '${cardId}' is already archived.`);
      return;
    }

    if (card.automation) {
      console.error(`Error: Cannot archive automation card '${card.title}'. Disable the automation first, then remove it.`);
      process.exit(1);
    }

    card.archived = true;
    // Don't bump updated_at — archiving is a status change, not a content change
    card.last_modified_by = 'cli';
    writeKanban(kanban);
    emitEvent('card_updated', PROJECT_NAME, `Card '${card.title}' archived`, cardId);

    console.log(`Archived card: ${cardId}`);
    console.log(`  Stage: ${stage}`);
    console.log(`  Title: ${card.title}`);
  }
}

function cmdChecklist(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(CHECKLIST_HELP);
    return;
  }

  const cardId = opts._[0];
  const action = opts._[1];

  if (!cardId) {
    console.error('Error: Card ID required');
    console.log(CHECKLIST_HELP);
    process.exit(1);
  }

  const kanban = readKanban();
  const result = findCard(kanban, cardId, true);

  if (!result) {
    console.error(`Error: Card '${cardId}' not found`);
    process.exit(1);
  }

  const { card } = result;

  if (!card.checklist) {
    card.checklist = [];
  }

  switch (action) {
    case 'list':
    case undefined:
      if (card.checklist.length === 0) {
        console.log('No checklist items.');
        return;
      }
      console.log(`Checklist for ${cardId}:\n`);
      for (const item of card.checklist) {
        const status = item.done ? '[x]' : '[ ]';
        console.log(`  ${status} ${item.text} (${item.id})`);
      }
      const done = card.checklist.filter(i => i.done).length;
      console.log(`\nProgress: ${done}/${card.checklist.length}`);
      break;

    case 'add':
      const text = opts._.slice(2).join(' ');
      if (!text) {
        console.error('Error: Checklist item text required');
        process.exit(1);
      }
      const newItem = {
        id: `check-${Date.now()}`,
        text: text,
        done: false,
      };
      card.checklist.push(newItem);
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      console.log(`Added checklist item: ${newItem.id}`);
      console.log(`  Text: ${text}`);
      break;

    case 'toggle':
      const toggleId = opts._[2];
      if (!toggleId) {
        console.error('Error: Item ID required');
        process.exit(1);
      }
      const toggleItem = card.checklist.find(i => i.id === toggleId);
      if (!toggleItem) {
        console.error(`Error: Checklist item '${toggleId}' not found`);
        process.exit(1);
      }
      toggleItem.done = !toggleItem.done;
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      console.log(`Toggled: ${toggleId}`);
      console.log(`  Status: ${toggleItem.done ? 'done' : 'pending'}`);
      break;

    case 'remove':
      const removeId = opts._[2];
      if (!removeId) {
        console.error('Error: Item ID required');
        process.exit(1);
      }
      const removeIndex = card.checklist.findIndex(i => i.id === removeId);
      if (removeIndex === -1) {
        console.error(`Error: Checklist item '${removeId}' not found`);
        process.exit(1);
      }
      card.checklist.splice(removeIndex, 1);
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      console.log(`Removed checklist item: ${removeId}`);
      break;

    default:
      console.error(`Error: Unknown action '${action}'`);
      console.log(CHECKLIST_HELP);
      process.exit(1);
  }
}

function cmdProblem(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(PROBLEM_HELP);
    return;
  }

  const cardId = opts._[0];
  const action = opts._[1];

  if (!cardId) {
    console.error('Error: Card ID required');
    console.log(PROBLEM_HELP);
    process.exit(1);
  }

  const kanban = readKanban();
  const result = findCard(kanban, cardId, true);

  if (!result) {
    console.error(`Error: Card '${cardId}' not found`);
    process.exit(1);
  }

  const { card } = result;

  if (!card.problems) {
    card.problems = [];
  }

  switch (action) {
    case 'list':
    case undefined:
      if (card.problems.length === 0) {
        console.log('No problems.');
        return;
      }
      console.log(`Problems for ${cardId}:\n`);
      const open = card.problems.filter(p => !p.resolved_at);
      const resolved = card.problems.filter(p => p.resolved_at);

      if (open.length > 0) {
        console.log('Open:');
        for (const prob of open) {
          console.log(`  [${prob.severity.toUpperCase()}] ${prob.description} (${prob.id})`);
        }
      }
      if (resolved.length > 0) {
        console.log('\nResolved:');
        for (const prob of resolved) {
          console.log(`  [RESOLVED] ${prob.description} (${prob.id})`);
        }
      }
      console.log(`\nTotal: ${open.length} open, ${resolved.length} resolved`);
      break;

    case 'add':
      const description = opts._.slice(2).join(' ');
      if (!description) {
        console.error('Error: Problem description required');
        process.exit(1);
      }
      const severity = opts.severity || 'minor';
      if (!VALID_SEVERITIES.includes(severity)) {
        console.error(`Error: Invalid severity '${severity}'. Valid: ${VALID_SEVERITIES.join(', ')}`);
        process.exit(1);
      }
      const newProblem = {
        id: `prob-${Date.now()}`,
        description: description,
        severity: severity,
        created_at: new Date().toISOString(),
      };
      card.problems.push(newProblem);
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      emitEvent('problem_added', PROJECT_NAME, `Problem added to '${card.title}': ${description}`, cardId);
      console.log(`Added problem: ${newProblem.id}`);
      console.log(`  Severity: ${severity}`);
      console.log(`  Description: ${description}`);
      break;

    case 'resolve':
      const resolveId = opts._[2];
      if (!resolveId) {
        console.error('Error: Problem ID required');
        process.exit(1);
      }
      const prob = card.problems.find(p => p.id === resolveId);
      if (!prob) {
        console.error(`Error: Problem '${resolveId}' not found`);
        process.exit(1);
      }
      if (prob.resolved_at) {
        console.log(`Problem '${resolveId}' is already resolved.`);
        return;
      }
      prob.resolved_at = new Date().toISOString();
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      emitEvent('problem_resolved', PROJECT_NAME, `Problem resolved on '${card.title}': ${prob.description}`, cardId);
      console.log(`Resolved problem: ${resolveId}`);
      console.log(`  Description: ${prob.description}`);
      break;

    case 'promote':
      const promoteId = opts._[2];
      if (!promoteId) {
        console.error('Error: Problem ID required');
        process.exit(1);
      }
      const promoteProb = card.problems.find(p => p.id === promoteId);
      if (!promoteProb) {
        console.error(`Error: Problem '${promoteId}' not found`);
        process.exit(1);
      }
      if (promoteProb.resolved_at) {
        console.error(`Error: Problem '${promoteId}' is already resolved. Cannot promote.`);
        process.exit(1);
      }

      // Determine card type and priority
      const promoteType = opts.type || 'bug';
      if (!VALID_TYPES.includes(promoteType)) {
        console.error(`Error: Invalid type '${promoteType}'. Valid: ${VALID_TYPES.join(', ')}`);
        process.exit(1);
      }

      // Default priority based on severity if not specified
      let promotePriority = opts.priority;
      if (!promotePriority) {
        promotePriority = promoteProb.severity === 'critical' ? 'high' :
                          promoteProb.severity === 'major' ? 'medium' : 'low';
      }
      if (!VALID_PRIORITIES.includes(promotePriority)) {
        console.error(`Error: Invalid priority '${promotePriority}'. Valid: ${VALID_PRIORITIES.join(', ')}`);
        process.exit(1);
      }

      // Create new backlog card
      const now = new Date().toISOString();
      const backlogCards = kanban.stages.backlog || [];
      const maxOrder = backlogCards.reduce((max, c) => Math.max(max, c.order || 0), 0);

      const newCard = {
        id: generateId('card'),
        title: promoteProb.description,
        description: `Promoted from ${cardId} (${card.title}).\n\nOriginal severity: ${promoteProb.severity}`,
        type: promoteType,
        priority: promotePriority,
        order: maxOrder + 10,
        areas: card.areas || [],
        tags: [],
        problems: [],
        checklist: [],
        created_at: now,
        updated_at: now,
        last_modified_by: 'cli',
      };

      kanban.stages.backlog.push(newCard);

      // Mark problem as resolved
      promoteProb.resolved_at = now;
      promoteProb.promoted_to = newCard.id;
      card.updated_at = now;
      card.last_modified_by = 'cli';

      writeKanban(kanban);

      console.log(`Promoted problem to backlog card: ${newCard.id}`);
      console.log(`  Title: ${newCard.title}`);
      console.log(`  Type: ${newCard.type}`);
      console.log(`  Priority: ${newCard.priority}`);
      console.log(`  Original problem resolved on: ${cardId}`);
      break;

    default:
      console.error(`Error: Unknown action '${action}'`);
      console.log(PROBLEM_HELP);
      process.exit(1);
  }
}

const MAX_NOTES_PER_CARD = 100;
const NOTES_SUGGEST_THRESHOLD = 30;
const MAX_NOTE_LENGTH = 3000;

function cmdNotes(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(NOTES_HELP);
    return;
  }

  const cardId = opts._[0];
  const action = opts._[1];

  if (!cardId) {
    console.error('Error: Card ID required');
    console.log(NOTES_HELP);
    process.exit(1);
  }

  const kanban = readKanban();
  const result = findCard(kanban, cardId, true);

  if (!result) {
    console.error(`Error: Card '${cardId}' not found`);
    process.exit(1);
  }

  const { card } = result;

  if (!card.agentNotes) {
    card.agentNotes = [];
  }

  switch (action) {
    case 'list':
    case undefined: {
      if (card.agentNotes.length === 0) {
        console.log('No notes.');
        return;
      }
      console.log(`Notes for ${cardId} (${card.agentNotes.length} notes):\n`);
      for (const note of card.agentNotes) {
        const agent = note.agent ? `  ${note.agent}` : '';
        const ts = note.timestamp ? note.timestamp.replace('T', ' ').slice(0, 16) : '';
        const summaryTag = note.summary ? '  [Summary]' : '';
        console.log(`  #${note.id}  [${ts}]${agent}${summaryTag}`);
        console.log(`      ${note.text}\n`);
      }
      console.log(`${card.agentNotes.length} notes (summarize suggested at ${NOTES_SUGGEST_THRESHOLD}, hard cap ${MAX_NOTES_PER_CARD})`);
      break;
    }

    case 'add': {
      const text = opts._.slice(2).join(' ');
      if (!text) {
        console.error('Error: Note text required');
        process.exit(1);
      }
      if (text.length > MAX_NOTE_LENGTH) {
        console.error(`Error: Note too long (${text.length} chars). Max ${MAX_NOTE_LENGTH}.`);
        process.exit(1);
      }
      if (card.agentNotes.length >= MAX_NOTES_PER_CARD) {
        console.error(`Error: Card has ${MAX_NOTES_PER_CARD} notes (hard cap). Summarize old notes first.`);
        console.error(`Run: sly-kanban notes ${cardId} oldest 20`);
        console.error(`Then: sly-kanban notes ${cardId} summarize "Your summary" --count 20 --agent "YourAgent"`);
        process.exit(1);
      }
      const maxId = card.agentNotes.reduce((max, n) => Math.max(max, n.id), 0);
      const newNote = {
        id: maxId + 1,
        text: text,
        timestamp: new Date().toISOString(),
      };
      if (opts.agent) {
        newNote.agent = opts.agent;
      }
      card.agentNotes.push(newNote);
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      console.log(`Added note #${newNote.id}`);
      if (newNote.agent) console.log(`  Agent: ${newNote.agent}`);
      console.log(`  Text: ${text}`);
      // Soft suggestion when threshold reached
      if (card.agentNotes.length >= NOTES_SUGGEST_THRESHOLD) {
        console.log('');
        console.log(`\u26a0 This card has ${card.agentNotes.length} notes (hard cap: ${MAX_NOTES_PER_CARD}). Consider summarizing the oldest 20 to keep notes manageable.`);
        console.log(`To read the oldest notes:`);
        console.log(`  sly-kanban notes ${cardId} oldest 20`);
        console.log(`Then summarize them into a single note (max ${MAX_NOTE_LENGTH} chars):`);
        console.log(`  sly-kanban notes ${cardId} summarize "Your summary" --count 20 --agent "YourAgent"`);
        console.log(`Tips: Preserve key decisions, recurring themes, important events, and unresolved issues. Compress routine status updates into trends. Keep the summary concise — it replaces 20 notes with one.`);
      }
      break;
    }

    case 'search': {
      const query = opts._.slice(2).join(' ').toLowerCase();
      if (!query) {
        console.error('Error: Search query required');
        process.exit(1);
      }
      const matches = card.agentNotes.filter(n =>
        n.text.toLowerCase().includes(query) ||
        (n.agent && n.agent.toLowerCase().includes(query))
      );
      if (matches.length === 0) {
        console.log(`No notes matching "${query}".`);
        return;
      }
      console.log(`Notes matching "${query}" (${matches.length}):\n`);
      for (const note of matches) {
        const agent = note.agent ? `  ${note.agent}` : '';
        const ts = note.timestamp ? note.timestamp.replace('T', ' ').slice(0, 16) : '';
        console.log(`  #${note.id}  [${ts}]${agent}`);
        console.log(`      ${note.text}\n`);
      }
      break;
    }

    case 'edit': {
      const editId = parseInt(opts._[2], 10);
      if (isNaN(editId)) {
        console.error('Error: Note ID required (integer)');
        process.exit(1);
      }
      const newText = opts._.slice(3).join(' ');
      if (!newText) {
        console.error('Error: New text required');
        process.exit(1);
      }
      if (newText.length > MAX_NOTE_LENGTH) {
        console.error(`Error: Note too long (${newText.length} chars). Max ${MAX_NOTE_LENGTH}.`);
        process.exit(1);
      }
      const editNote = card.agentNotes.find(n => n.id === editId);
      if (!editNote) {
        console.error(`Error: Note #${editId} not found`);
        process.exit(1);
      }
      editNote.text = newText;
      editNote.timestamp = new Date().toISOString();
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      console.log(`Updated note #${editId}`);
      console.log(`  Text: ${newText}`);
      break;
    }

    case 'delete': {
      const deleteId = parseInt(opts._[2], 10);
      if (isNaN(deleteId)) {
        console.error('Error: Note ID required (integer)');
        process.exit(1);
      }
      const deleteIndex = card.agentNotes.findIndex(n => n.id === deleteId);
      if (deleteIndex === -1) {
        console.error(`Error: Note #${deleteId} not found`);
        process.exit(1);
      }
      card.agentNotes.splice(deleteIndex, 1);
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      console.log(`Deleted note #${deleteId}`);
      break;
    }

    case 'clear': {
      const count = card.agentNotes.length;
      if (count === 0) {
        console.log('No notes to clear.');
        return;
      }
      card.agentNotes = [];
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      console.log(`Cleared ${count} notes from ${cardId}`);
      break;
    }

    case 'oldest': {
      const count = parseInt(opts._[2], 10) || 20;
      if (card.agentNotes.length === 0) {
        console.log('No notes.');
        return;
      }
      const oldest = card.agentNotes.slice(0, count);
      console.log(`Oldest ${oldest.length} of ${card.agentNotes.length} notes for ${cardId}:\n`);
      for (const note of oldest) {
        const agent = note.agent ? `  ${note.agent}` : '';
        const ts = note.timestamp ? note.timestamp.replace('T', ' ').slice(0, 16) : '';
        const summaryTag = note.summary ? '  [Summary]' : '';
        console.log(`  #${note.id}  [${ts}]${agent}${summaryTag}`);
        console.log(`      ${note.text}\n`);
      }
      break;
    }

    case 'summarize': {
      const summaryText = opts._.slice(2).join(' ');
      if (!summaryText) {
        console.error('Error: Summary text required');
        console.error('Usage: sly-kanban notes <card-id> summarize "Your summary text" --count 20');
        process.exit(1);
      }
      if (summaryText.length > MAX_NOTE_LENGTH) {
        console.error(`Error: Summary too long (${summaryText.length} chars). Max ${MAX_NOTE_LENGTH}.`);
        process.exit(1);
      }
      const summarizeCount = parseInt(opts.count, 10) || 20;
      if (card.agentNotes.length === 0) {
        console.error('Error: No notes to summarize.');
        process.exit(1);
      }
      const toSummarize = card.agentNotes.slice(0, Math.min(summarizeCount, card.agentNotes.length));
      if (toSummarize.length === 0) {
        console.error('Error: No notes to summarize.');
        process.exit(1);
      }
      const firstTs = toSummarize[0].timestamp ? toSummarize[0].timestamp.slice(0, 10) : 'unknown';
      const lastTs = toSummarize[toSummarize.length - 1].timestamp ? toSummarize[toSummarize.length - 1].timestamp.slice(0, 10) : 'unknown';
      const maxId = card.agentNotes.reduce((max, n) => Math.max(max, n.id), 0);
      const summaryNote = {
        id: maxId + 1,
        text: summaryText,
        timestamp: new Date().toISOString(),
        summary: true,
        summarizedCount: toSummarize.length,
        dateRange: `${firstTs} to ${lastTs}`,
      };
      if (opts.agent) {
        summaryNote.agent = opts.agent;
      }
      // Remove summarized notes and prepend the summary
      card.agentNotes = [summaryNote, ...card.agentNotes.slice(toSummarize.length)];
      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      console.log(`Summarized ${toSummarize.length} notes into summary note #${summaryNote.id}`);
      console.log(`  Date range: ${summaryNote.dateRange}`);
      console.log(`  Remaining notes: ${card.agentNotes.length}`);
      break;
    }

    default:
      console.error(`Error: Unknown action '${action}'`);
      console.log(NOTES_HELP);
      process.exit(1);
  }
}

function cmdAreas(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(AREAS_HELP);
    return;
  }

  try {
    const content = fs.readFileSync(AREA_INDEX_PATH, 'utf-8');

    // Parse area names from the index file
    // Looking for lines like: ## area-name or **area-name** or - area-name
    const areaPattern = /^##\s+(\S+)|^\*\*(\S+)\*\*|^-\s+\*\*(\S+)\*\*/gm;
    const areas = [];
    let match;

    while ((match = areaPattern.exec(content)) !== null) {
      const area = match[1] || match[2] || match[3];
      if (area && !area.includes('#') && !areas.includes(area)) {
        areas.push(area);
      }
    }

    // Also look for area files in the areas directory
    const areasDir = path.join(path.dirname(AREA_INDEX_PATH), 'areas');
    if (fs.existsSync(areasDir)) {
      const files = fs.readdirSync(areasDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const areaName = file.replace('.md', '');
          if (!areas.includes(areaName)) {
            areas.push(areaName);
          }
        }
      }
    }

    if (areas.length === 0) {
      console.log('No areas found in area-index.md');
      return;
    }

    console.log('Available areas:\n');
    for (const area of areas.sort()) {
      console.log(`  ${area}`);
    }
    console.log(`\nTotal: ${areas.length} areas`);

  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('Error: area-index.md not found');
      console.error('Expected at:', AREA_INDEX_PATH);
    } else {
      console.error('Error reading area-index.md:', err.message);
    }
    process.exit(1);
  }
}

// ============================================================================
// Automation Command
// ============================================================================

function cmdAutomation(args) {
  const opts = parseArgs(args);

  if (opts.help || args.length === 0) {
    console.log(AUTOMATION_HELP);
    return;
  }

  const subcommand = opts._[0];

  switch (subcommand) {
    case 'configure': {
      const cardId = opts._[1];
      if (!cardId) {
        console.error('Error: Card ID required');
        process.exit(1);
      }

      const kanban = readKanban();
      const result = findCard(kanban, cardId, true);
      if (!result) {
        console.error(`Error: Card '${cardId}' not found`);
        process.exit(1);
      }

      const { card } = result;
      const updates = [];

      // Initialize automation config if not present
      if (!card.automation) {
        card.automation = {
          enabled: false,
          schedule: '',
          scheduleType: 'recurring',
          provider: 'claude',
          freshSession: false,
          reportViaMessaging: false,
        };
        updates.push('automation config initialized');
      }

      // Partial updates — only change specified fields
      if (opts.schedule !== undefined) {
        card.automation.schedule = opts.schedule;
        updates.push(`schedule: ${opts.schedule}`);
      }
      if (opts['schedule-type'] !== undefined) {
        if (!['recurring', 'one-shot'].includes(opts['schedule-type'])) {
          console.error('Error: schedule-type must be "recurring" or "one-shot"');
          process.exit(1);
        }
        card.automation.scheduleType = opts['schedule-type'];
        updates.push(`scheduleType: ${opts['schedule-type']}`);
      }
      if (opts.provider !== undefined) {
        card.automation.provider = opts.provider;
        updates.push(`provider: ${opts.provider}`);
      }
      if (opts['fresh-session'] !== undefined) {
        card.automation.freshSession = opts['fresh-session'] === 'true' || opts['fresh-session'] === true;
        updates.push(`freshSession: ${card.automation.freshSession}`);
      }
      if (opts['working-dir'] !== undefined) {
        card.automation.workingDirectory = opts['working-dir'];
        updates.push(`workingDirectory: ${opts['working-dir']}`);
      }
      if (opts['report-messaging'] !== undefined) {
        card.automation.reportViaMessaging = opts['report-messaging'] === 'true' || opts['report-messaging'] === true;
        updates.push(`reportViaMessaging: ${card.automation.reportViaMessaging}`);
      }

      card.updated_at = new Date().toISOString();
      card.last_modified_by = 'cli';
      writeKanban(kanban);
      emitEvent('card_updated', PROJECT_NAME, `Automation configured on '${card.title}': ${updates.join(', ')}`, cardId);

      console.log(`Configured automation: ${cardId}`);
      for (const u of updates) {
        console.log(`  ${u}`);
      }
      break;
    }

    case 'enable': {
      const cardId = opts._[1];
      if (!cardId) {
        console.error('Error: Card ID required');
        process.exit(1);
      }

      const kanban = readKanban();
      const result = findCard(kanban, cardId, true);
      if (!result) {
        console.error(`Error: Card '${cardId}' not found`);
        process.exit(1);
      }

      if (!result.card.automation) {
        console.error('Error: Card has no automation config. Run "automation configure" first.');
        process.exit(1);
      }

      result.card.automation.enabled = true;
      result.card.updated_at = new Date().toISOString();
      result.card.last_modified_by = 'cli';
      writeKanban(kanban);
      emitEvent('card_updated', PROJECT_NAME, `Automation enabled on '${result.card.title}'`, cardId);
      console.log(`Automation enabled: ${cardId}`);
      break;
    }

    case 'disable': {
      const cardId = opts._[1];
      if (!cardId) {
        console.error('Error: Card ID required');
        process.exit(1);
      }

      const kanban = readKanban();
      const result = findCard(kanban, cardId, true);
      if (!result) {
        console.error(`Error: Card '${cardId}' not found`);
        process.exit(1);
      }

      if (!result.card.automation) {
        console.error('Error: Card has no automation config.');
        process.exit(1);
      }

      result.card.automation.enabled = false;
      result.card.updated_at = new Date().toISOString();
      result.card.last_modified_by = 'cli';
      writeKanban(kanban);
      emitEvent('card_updated', PROJECT_NAME, `Automation disabled on '${result.card.title}'`, cardId);
      console.log(`Automation disabled: ${cardId}`);
      break;
    }

    case 'run': {
      const cardId = opts._[1];
      if (!cardId) {
        console.error('Error: Card ID required');
        process.exit(1);
      }

      const kanban = readKanban();
      const result = findCard(kanban, cardId, true);
      if (!result) {
        console.error(`Error: Card '${cardId}' not found`);
        process.exit(1);
      }

      if (!result.card.automation) {
        console.error('Error: Card has no automation config.');
        process.exit(1);
      }

      const auto = result.card.automation;
      const description = result.card.description;
      if (!description) {
        console.error('Error: Card has no description (used as automation prompt).');
        process.exit(1);
      }

      // Determine bridge URL from environment
      const bridgePort = process.env.BRIDGE_PORT || process.env.PORT || '3004';
      const bridgeUrl = process.env.BRIDGE_URL || `http://localhost:${bridgePort}`;
      const provider = auto.provider || 'claude';
      const sessionName = `${PROJECT_NAME}:${provider}:card:${card.id}`;

      console.log(`Triggering automation: ${cardId}`);
      console.log(`  Session: ${sessionName}`);
      console.log(`  Provider: ${provider}`);
      console.log(`  Prompt: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}`);

      // Build the prompt from card description (with optional messaging instructions)
      let fullPrompt = description;
      if (auto.reportViaMessaging) {
        fullPrompt += '\n\nAfter completing the task, send a summary of the results using the messaging skill: sly-messaging send "<your summary>"';
      }

      // Use fetch to call bridge API (Node 18+)
      const doRun = async () => {
        try {
          // Create or reuse session
          const cwd = auto.workingDirectory || PROJECT_ROOT;
          const createRes = await fetch(`${bridgeUrl}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: sessionName,
              provider,
              skipPermissions: true,
              cwd,
              prompt: fullPrompt,
              fresh: auto.freshSession || false,
            }),
          });

          if (!createRes.ok) {
            const errText = await createRes.text();
            // Session might already exist — try sending input directly
            if (createRes.status === 409) {
              console.log('  Session already exists, sending prompt...');
              const inputRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: fullPrompt + '\r' }),
              });
              if (!inputRes.ok) {
                console.error(`Error sending input: ${await inputRes.text()}`);
                process.exit(1);
              }
              console.log('  Prompt sent to existing session.');
            } else {
              console.error(`Error creating session: ${errText}`);
              process.exit(1);
            }
          } else {
            console.log('  Session created and prompt sent.');
          }

          // Update lastRun
          result.card.automation.lastRun = new Date().toISOString();
          result.card.automation.lastResult = 'success';
          result.card.updated_at = new Date().toISOString();
          result.card.last_modified_by = 'cli';
          writeKanban(kanban);
          console.log('  Automation triggered successfully.');
        } catch (err) {
          console.error(`Error: ${err.message}`);
          console.error('  Is the bridge server running?');
          result.card.automation.lastRun = new Date().toISOString();
          result.card.automation.lastResult = 'error';
          result.card.updated_at = new Date().toISOString();
          result.card.last_modified_by = 'cli';
          writeKanban(kanban);
          process.exit(1);
        }
      };

      doRun();
      break;
    }

    case 'status': {
      const cardId = opts._[1];
      if (!cardId) {
        console.error('Error: Card ID required');
        process.exit(1);
      }

      const kanban = readKanban();
      const result = findCard(kanban, cardId, true);
      if (!result) {
        console.error(`Error: Card '${cardId}' not found`);
        process.exit(1);
      }

      if (!result.card.automation) {
        console.log(`Card '${cardId}' has no automation config.`);
        return;
      }

      const { card, stage } = result;
      const auto = card.automation;
      console.log(`\nAutomation: ${card.title}`);
      console.log(`Card ID: ${card.id}`);
      console.log(`Stage: ${stage}`);
      console.log(`Enabled: ${auto.enabled}`);
      console.log(`Schedule: ${auto.schedule || '(not set)'}`);
      console.log(`Schedule Type: ${auto.scheduleType}`);
      console.log(`Provider: ${auto.provider}`);
      console.log(`Description (prompt): ${card.description ? card.description.substring(0, 200) + (card.description.length > 200 ? '...' : '') : '(empty)'}`);
      console.log(`Fresh Session: ${auto.freshSession}`);
      if (auto.workingDirectory) console.log(`Working Dir: ${auto.workingDirectory}`);
      console.log(`Report via Messaging: ${auto.reportViaMessaging}`);
      console.log(`Last Run: ${auto.lastRun || 'never'}`);
      console.log(`Last Result: ${auto.lastResult || 'n/a'}`);
      console.log(`Next Run: ${auto.nextRun || 'n/a'}`);
      break;
    }

    case 'list': {
      const kanban = readKanban();
      const allCards = getAllCards(kanban, true);
      let automationCards = allCards.filter(({ card }) => card.automation);

      // Filter by tag if specified
      if (opts.tag) {
        automationCards = automationCards.filter(({ card }) =>
          card.tags && card.tags.includes(opts.tag)
        );
      }

      if (automationCards.length === 0) {
        console.log('No automation cards found.');
        return;
      }

      console.log(`Found ${automationCards.length} automation card(s):\n`);
      console.log('ID\tEnabled\tSchedule\tProvider\tLast Run\tTitle');
      console.log('-'.repeat(100));
      for (const { card } of automationCards) {
        const auto = card.automation;
        const enabled = auto.enabled ? 'YES' : 'no';
        const schedule = auto.schedule || '(none)';
        const provider = auto.provider || 'claude';
        const lastRun = auto.lastRun ? auto.lastRun.replace('T', ' ').slice(0, 16) : 'never';
        console.log(`${card.id}\t${enabled}\t${schedule}\t${provider}\t${lastRun}\t${card.title}`);
      }
      break;
    }

    default:
      console.error(`Error: Unknown automation subcommand '${subcommand}'`);
      console.log(AUTOMATION_HELP);
      process.exit(1);
  }
}

// ============================================================================
// Board & Reorder Commands
// ============================================================================

function cmdBoard(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(BOARD_HELP);
    return;
  }

  const kanban = readKanban();

  // Determine which stages to show (precedence: --stages > --inflight > --all > default)
  let stagesToShow;
  if (opts.stages) {
    stagesToShow = opts.stages.split(',').map(s => s.trim());
    for (const s of stagesToShow) {
      if (!VALID_STAGES.includes(s)) {
        console.error(`Error: Invalid stage '${s}'. Valid: ${VALID_STAGES.join(', ')}`);
        process.exit(1);
      }
    }
  } else if (opts.inflight) {
    stagesToShow = ['design', 'implementation', 'testing'];
  } else if (opts.all) {
    stagesToShow = [...VALID_STAGES];
  } else {
    stagesToShow = ['backlog', 'design', 'implementation', 'testing'];
  }

  const compact = opts.compact === true;

  // Collect cards per stage (pipeline order)
  const stageData = [];
  for (const stage of VALID_STAGES) {
    if (!stagesToShow.includes(stage)) continue;
    const cards = (kanban.stages[stage] || [])
      .filter(c => !c.archived && !c.automation)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    stageData.push({ stage, cards });
  }

  // Summary header
  const summary = stageData.map(({ stage, cards }) =>
    `${cards.length} ${stage}`
  ).join(' | ');
  console.log(`Board: ${summary}`);

  const totalCards = stageData.reduce((sum, { cards }) => sum + cards.length, 0);
  if (totalCards === 0) {
    console.log('\nNo cards found.');
    return;
  }

  // Output per stage
  for (const { stage, cards } of stageData) {
    if (cards.length === 0) continue;
    const label = stage.toUpperCase();
    const plural = cards.length === 1 ? 'card' : 'cards';
    console.log(`\n${'═'.repeat(3)} ${label} (${cards.length} ${plural}) ${'═'.repeat(3)}`);

    if (compact) {
      cards.forEach((card, i) => {
        console.log(`  ${i + 1}. ${card.id}  [${card.priority}]  ${card.title}`);
      });
    } else {
      for (const card of cards) {
        console.log(formatCard(card, stage, true));
      }
    }
  }
}

function cmdReorder(args) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(REORDER_HELP);
    return;
  }

  const stage = opts._[0];
  if (!stage) {
    console.error('Error: Stage required');
    console.log(REORDER_HELP);
    process.exit(1);
  }

  if (!VALID_STAGES.includes(stage)) {
    console.error(`Error: Invalid stage '${stage}'. Valid: ${VALID_STAGES.join(', ')}`);
    process.exit(1);
  }

  const kanban = readKanban();
  const stageCards = (kanban.stages[stage] || [])
    .filter(c => !c.archived)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  // Helper: validate a card ID is in the specified stage
  function validateCardInStage(cardId) {
    const inStage = stageCards.find(c => c.id === cardId);
    if (inStage) return inStage;

    // Check other stages for a helpful error
    const elsewhere = findCard(kanban, cardId, true);
    if (elsewhere) {
      console.error(`Error: Card '${cardId}' is in '${elsewhere.stage}', not '${stage}'`);
    } else {
      console.error(`Error: Card '${cardId}' not found`);
    }
    process.exit(1);
  }

  // Helper: renumber all cards in stage and print confirmation
  function applyAndConfirm(orderedCards) {
    orderedCards.forEach((card, i) => {
      card.order = (i + 1) * 10;
      // Don't update updated_at — reordering is not a content change.
      // Stamping updated_at here inflates recency for all cards in the stage.
    });
    writeKanban(kanban);
    emitEvent('card_reordered', PROJECT_NAME, `Reordered ${orderedCards.length} cards in ${stage}`);

    console.log(`Reordered ${stage}:`);
    orderedCards.forEach((card, i) => {
      console.log(`  ${i + 1}. ${card.id} — ${card.title}`);
    });
  }

  // Mode A: --top <card-id>
  if (opts.top) {
    const card = validateCardInStage(opts.top);
    const others = stageCards.filter(c => c.id !== opts.top);
    applyAndConfirm([card, ...others]);
    return;
  }

  // Mode A: --bottom <card-id>
  if (opts.bottom) {
    const card = validateCardInStage(opts.bottom);
    const others = stageCards.filter(c => c.id !== opts.bottom);
    applyAndConfirm([...others, card]);
    return;
  }

  // Mode A: --position <n> <card-id>
  if (opts.position) {
    const pos = parseInt(opts.position, 10);
    if (isNaN(pos) || pos < 1) {
      console.error('Error: --position must be a positive integer (1-indexed)');
      process.exit(1);
    }
    const cardId = opts._[1];
    if (!cardId) {
      console.error('Error: Card ID required after --position <n>');
      console.log(REORDER_HELP);
      process.exit(1);
    }
    const card = validateCardInStage(cardId);
    const others = stageCards.filter(c => c.id !== cardId);
    // Clamp position to valid range
    const insertAt = Math.min(pos - 1, others.length);
    others.splice(insertAt, 0, card);
    applyAndConfirm(others);
    return;
  }

  // Mode B: Full reorder with positional card IDs
  const cardIds = opts._.slice(1);
  if (cardIds.length === 0) {
    console.error('Error: Provide card IDs to reorder, or use --top/--bottom/--position');
    console.log(REORDER_HELP);
    process.exit(1);
  }

  // Validate all card IDs exist in stage
  const listedCards = cardIds.map(id => validateCardInStage(id));

  // Unlisted cards keep relative order, sort after listed
  const listedSet = new Set(cardIds);
  const unlistedCards = stageCards.filter(c => !listedSet.has(c.id));

  applyAndConfirm([...listedCards, ...unlistedCards]);
}

// ============================================================================
// Prompt Command (cross-card execution)
// ============================================================================

function cmdPrompt(args) {
  const opts = parseArgs(args);

  if (opts.help || args.length === 0) {
    console.log(PROMPT_HELP);
    return;
  }

  const cardId = opts._[0];
  const promptText = opts._[1];

  if (!cardId) {
    console.error('Error: Card ID required');
    process.exit(1);
  }

  if (!promptText) {
    console.error('Error: Prompt text required');
    console.error('Usage: kanban prompt <card-id> "your prompt text"');
    process.exit(1);
  }

  const kanban = readKanban();
  const result = findCard(kanban, cardId);
  if (!result) {
    console.error(`Error: Card '${cardId}' not found`);
    process.exit(1);
  }

  const { card, stage } = result;
  const providerFlag = opts.provider;
  const modelFlag = opts.model;
  const create = opts.create || false;
  const wait = opts.wait || false;
  const timeout = parseInt(opts.timeout || '120', 10);
  const force = opts.force || false;
  const fresh = opts.fresh || false;

  // Determine bridge URL
  const bridgePort = process.env.BRIDGE_PORT || process.env.PORT || '3004';
  const bridgeUrl = process.env.BRIDGE_URL || `http://localhost:${bridgePort}`;

  // Load providers.json for stage defaults
  let providers = null;
  try {
    const providersPath = path.join(PROJECT_ROOT, 'data', 'providers.json');
    providers = JSON.parse(fs.readFileSync(providersPath, 'utf-8'));
  } catch { /* providers.json optional */ }

  const doPrompt = async () => {
    try {
      // Resolve provider: flag > stage default > 'claude'
      let provider = providerFlag;
      if (!provider && providers?.defaults?.stages?.[stage]) {
        provider = providers.defaults.stages[stage].provider;
      }
      if (!provider) provider = 'claude';

      const sessionName = `${PROJECT_NAME}:${provider}:card:${card.id}`;

      // Check if session exists on bridge
      let sessionExists = false;
      let sessionRunning = false;
      let sessionStatus = 'not_found';
      try {
        const infoRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}`);
        if (infoRes.ok) {
          const info = await infoRes.json();
          if (info && info.status) {
            sessionExists = true;
            sessionStatus = info.status;
            sessionRunning = info.status === 'running';
          }
        }
      } catch (err) {
        if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
          console.error('Error: Bridge is not running. Start it with: cd bridge && npm run dev');
          process.exit(1);
        }
        throw err;
      }

      // --fresh: stop existing session so we get a clean one with CLI-arg delivery
      if (fresh && sessionRunning) {
        console.log(`  Stopping existing session (--fresh)...`);
        try {
          await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}?action=stop`, { method: 'DELETE' });
          // Brief wait for cleanup
          await new Promise(r => setTimeout(r, 1000));
        } catch { /* best effort */ }
        sessionRunning = false;
        sessionStatus = 'stopped';
      }

      // Build the full prompt upfront (with callback instruction for --wait)
      // This must happen BEFORE session creation so it can be passed as a CLI arg
      // Auto-prepend card context so the called AI always knows its own card.
      // Status is included as quoted untrusted card metadata (prompt-injection mitigation).
      const cardContextStatusObj = readStatus(card.status);
      const cardContextStatusLines = cardContextStatusObj
        ? '\n' + formatStatusForPromptCli(cardContextStatusObj).join('\n')
        : '';
      const cardContext = `[Card: ${card.title} (${card.id})]
Stage: ${stage} | Type: ${card.type || 'unknown'} | Priority: ${card.priority || 'unknown'}
Description: ${card.description || '(no description)'}${cardContextStatusLines}
---

`;
      let fullPrompt = cardContext + promptText;
      let responseId = null;

      // Always register a response channel and append callback instructions if we have a calling session.
      // For --wait: caller polls for the response.
      // For fire-and-forget: caller is marked timed-out immediately, so any response gets late-injected
      // into the calling session's PTY via the bridge (same path as a timed-out --wait).
      const callingSessionForResponse = process.env.SLYCODE_SESSION || null;
      const includeCallback = !!callingSessionForResponse;

      if (includeCallback) {
        responseId = `resp-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        const verb = wait ? 'When you have completed this task, you MUST' : 'When you have completed this task, you may';
        fullPrompt += `\n\n${wait ? 'IMPORTANT: ' : ''}${verb} return your response by running sly-kanban respond.${wait ? '' : ' (Optional — the calling card will receive your response asynchronously.)'}

For ANY response that may contain backticks, $(...), backslashes, embedded quotes, code, or multiple lines, use the heredoc form to avoid shell-quoting corruption.

Bash / zsh / Git Bash / WSL (preferred):

sly-kanban respond ${responseId} --stdin <<'EOF'
<your response here — backticks, $(...), quotes, and multi-line content are all safe inside this single-quoted heredoc>
EOF

PowerShell or cmd.exe (no heredoc — pipe a here-string or a file instead):

@'
<your response here>
'@ | sly-kanban respond ${responseId}

# or:  Get-Content reply.txt | sly-kanban respond ${responseId}

For SHORT, single-line responses with no special characters, the positional form also works on any shell:

sly-kanban respond ${responseId} "your response"

Either way, the CLI will print a success line with the byte count and a preview so you can verify the right bytes were delivered.`;

        // Register response on bridge
        const regRes = await fetch(`${bridgeUrl}/responses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            responseId,
            callingSession: callingSessionForResponse,
            targetSession: sessionName,
          }),
        });
        if (!regRes.ok) {
          if (wait) {
            console.error('Error: Failed to register response on bridge.');
            process.exit(1);
          }
          // Fire-and-forget: registration failure is non-fatal, just skip the callback
          responseId = null;
        }

        // Fire-and-forget: mark caller as timed out immediately so any response gets late-injected
        if (responseId && !wait) {
          try {
            await fetch(`${bridgeUrl}/responses/${responseId}/timeout`, { method: 'POST' });
          } catch { /* best effort */ }
        }
      }

      // Helper: release response lock on error (prevents lock leak)
      const cleanupResponseLock = async () => {
        if (responseId) {
          try { await fetch(`${bridgeUrl}/responses/${responseId}/timeout`, { method: 'POST' }); } catch { /* best effort */ }
        }
      };

      // Handle no running session — resume if stopped, create fresh if none exists
      if (!sessionRunning) {
        const isStopped = sessionExists && (sessionStatus === 'stopped' || sessionStatus === 'detached');
        const isFresh = fresh || !isStopped;  // --fresh forces fresh; no prior session = fresh

        if (isStopped && !fresh) {
          console.log(`Resuming stopped session for card ${cardId}...`);
        } else {
          console.log(`No running session for card ${cardId}. Starting one...`);
        }
        console.log(`${isFresh ? 'Creating' : 'Resuming'} session: ${sessionName} (provider: ${provider}${modelFlag ? ', model: ' + modelFlag : ''})`);

        // Record prompt chain depth BEFORE creating session (prevents race condition)
        const callingSessionForCreate = process.env.SLYCODE_SESSION || undefined;
        if (callingSessionForCreate) {
          try {
            const chainRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/chain`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callingSession: callingSessionForCreate }),
            });
            const chainResult = await chainRes.json();
            if (!chainResult.success) {
              console.error(`Error: ${chainResult.error || 'Depth limit reached'}`);
              process.exit(1);
            }
          } catch { /* best effort */ }
        }
        const createBody = {
          name: sessionName,
          provider,
          skipPermissions: true,
          cwd: PROJECT_ROOT,
          fresh: isFresh,
          prompt: fullPrompt,  // Always pass prompt as CLI arg — OS-level delivery, no timing issues
        };
        if (isFresh && modelFlag) createBody.model = modelFlag;  // Model only on fresh (resume reconnects to existing)

        const createRes = await fetch(`${bridgeUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });

        if (!createRes.ok) {
          const errBody = await createRes.text();
          console.error(`Error creating session: ${errBody}`);
          await cleanupResponseLock();
          process.exit(1);
        }

        // Wait for session to be alive (liveness check)
        console.log('  Waiting for session to start...');
        const livenessStart = Date.now();
        const livenessTimeout = 20000; // 20s
        let alive = false;
        while (Date.now() - livenessStart < livenessTimeout) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const checkRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}`);
            if (checkRes.ok) {
              const checkInfo = await checkRes.json();
              if (checkInfo && checkInfo.status === 'running') {
                alive = true;
                break;
              }
              if (checkInfo && checkInfo.status === 'stopped') {
                console.error('Error: Session stopped during startup.');
                await cleanupResponseLock();
                process.exit(1);
              }
            }
          } catch { /* retry */ }
        }

        if (!alive) {
          console.error('Error: Session did not start within 20s.');
          await cleanupResponseLock();
          process.exit(1);
        }
        console.log('  Session started. Prompt delivered via CLI arg.');

        // For fire-and-forget, prompt was passed as CLI arg — we're done
        if (!wait) {
          console.log(`Prompt delivered to ${cardId} via session creation.`);
          emitEvent(kanban, 'card.prompt', { cardId, provider, mode: 'fire-and-forget', created: true });
          return;
        }

        // For --wait, prompt was already delivered via CLI arg — skip to polling
      } else {
        // Session was already running — submit prompt via bridge submit endpoint
        // Pass callingSession for depth tracking (derive from SLYCODE_SESSION env or best guess)
        const callingSession = process.env.SLYCODE_SESSION || undefined;
        const submitRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: fullPrompt, force, callingSession }),
        });

        const submitResult = await submitRes.json();

        if (!submitRes.ok) {
          if (submitResult.locked) {
            console.error(`Error: ${submitResult.error}`);
          } else if (submitResult.busy) {
            console.error(`Warning: ${submitResult.error}`);
          } else {
            console.error(`Error: ${submitResult.error || 'Failed to submit prompt'}`);
          }
          await cleanupResponseLock();
          process.exit(1);
        }

        // Fire-and-forget mode
        if (!wait) {
          console.log(`Prompt delivered to ${cardId} (session: ${sessionName}).`);
          emitEvent(kanban, 'card.prompt', { cardId, provider, mode: 'fire-and-forget' });
          return;
        }
      }

      // --wait mode: poll for response
      console.log(`Prompt sent to ${cardId}. Waiting for response (timeout: ${timeout}s)...`);
      const pollStart = Date.now();
      const pollInterval = 2000; // 2 seconds
      const timeoutMs = timeout * 1000;

      while (Date.now() - pollStart < timeoutMs) {
        await new Promise(r => setTimeout(r, pollInterval));

        try {
          const pollRes = await fetch(`${bridgeUrl}/responses/${responseId}`);
          if (pollRes.ok) {
            const pollData = await pollRes.json();
            if (pollData.status === 'received' && pollData.data) {
              // Happy path: response received
              console.log(pollData.data);
              emitEvent(kanban, 'card.prompt', { cardId, provider, mode: 'wait', outcome: 'received' });
              return;
            }
          }
        } catch { /* retry */ }
      }

      // Timeout — determine which outcome
      // Mark caller as timed out so bridge can inject late responses
      try {
        await fetch(`${bridgeUrl}/responses/${responseId}/timeout`, { method: 'POST' });
      } catch { /* best effort */ }

      // Check if target session is still active
      let isActive = false;
      try {
        const statsRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}`);
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          if (statsData && statsData.lastOutputAt) {
            const outputAge = Date.now() - new Date(statsData.lastOutputAt).getTime();
            isActive = outputAge < 3000; // active if output within 3s
          }
        }
      } catch { /* ignore */ }

      if (isActive) {
        // Outcome 2: timeout + activity ongoing
        console.error(`[TIMEOUT] Target session is still actively processing (active for ${Math.round((Date.now() - pollStart) / 1000)}s).`);
        console.error('A response may still arrive — the session appears to be working.');
        console.error('If you need the response, you can wait longer.');
        console.error(`Session: ${sessionName}`);
      } else {
        // Outcome 3: timeout + activity stopped — fetch snapshot
        let snapshot = '';
        try {
          const snapRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/snapshot?lines=20`);
          if (snapRes.ok) {
            const snapData = await snapRes.json();
            snapshot = snapData.content || '';
          }
        } catch { /* ignore */ }

        console.error(`[TIMEOUT] Target session stopped processing without responding (timeout: ${timeout}s).`);
        if (snapshot) {
          console.error('\nTerminal snapshot (last 20 lines):');
          console.error('---');
          console.error(snapshot);
          console.error('---');
        }
        console.error('\nPossible cause: Permission prompt, user-facing question, or agent did not call respond.');
        console.error(`Session: ${sessionName}`);
      }

      emitEvent(kanban, 'card.prompt', { cardId, provider, mode: 'wait', outcome: 'timeout', active: isActive });
      process.exit(1);

    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        console.error('Error: Bridge is not running. Start it with: cd bridge && npm run dev');
      } else {
        console.error('Error:', err.message);
      }
      process.exit(1);
    }
  };

  doPrompt();
}

// ============================================================================
// Respond Command (cross-card callback)
// ============================================================================

// Hex-escape control bytes and C1 codes; escape backslash and double-quote so
// the result can safely sit inside a quoted preview. Tab/newline/CR get the
// readable two-char form rather than \xNN. Truncates to roughly maxChars
// visible width with an ellipsis. Used both on the success line and (mirrored
// in the bridge) on late-injection content.
function sanitisePreview(payload, maxChars = 80) {
  let out = '';
  for (let i = 0; i < payload.length; i++) {
    if (out.length >= maxChars * 4) break;
    const code = payload.charCodeAt(i);
    if (code === 0x09) { out += '\\t'; continue; }
    if (code === 0x0A) { out += '\\n'; continue; }
    if (code === 0x0D) { out += '\\r'; continue; }
    if (code < 0x20 || code === 0x7F || (code >= 0x80 && code <= 0x9F)) {
      out += '\\x' + code.toString(16).padStart(2, '0');
      continue;
    }
    if (code === 0x22) { out += '\\"'; continue; }
    if (code === 0x5C) { out += '\\\\'; continue; }
    out += payload[i];
  }
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
  return out;
}

function normalisePayload(payload) {
  if (payload.charCodeAt(0) === 0xFEFF) payload = payload.slice(1);
  payload = payload.replace(/\r\n/g, '\n');
  if (payload.endsWith('\n')) payload = payload.slice(0, -1);
  return payload;
}

// Heuristic — flags payloads that may have been mangled by the shell before
// reaching argv. False positives are possible on legitimate code-as-payload;
// this only triggers a warning, never blocks delivery.
function containsShellHostileChars(payload) {
  if (/`/.test(payload)) return true;
  if (/\$\(/.test(payload)) return true;
  const dq = (payload.match(/(?<!\\)"/g) || []).length;
  if (dq % 2 === 1) return true;
  return false;
}

function readStdinUtf8() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', err => reject(err));
  });
}

function parseResponseIdTimestamp(responseId) {
  const match = /^resp-(\d+)-/.exec(responseId);
  return match ? parseInt(match[1], 10) : null;
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return `${minutes}m ${remSec}s`;
}

function formatRespondError(responseId, errBody) {
  const reason = errBody && errBody.reason;
  const issuedAtFromBridge = errBody && errBody.issuedAt;
  const issuedAt = issuedAtFromBridge || parseResponseIdTimestamp(responseId);
  const expiredAt = errBody && errBody.expiredAt;
  const now = Date.now();

  if (reason === 'expired') {
    if (issuedAt) {
      const age = now - issuedAt;
      let msg = `Response ID was issued ${formatDuration(age)} ago, exceeded the 10-minute TTL.`;
      if (expiredAt) msg += ` (Expired ${formatDuration(now - expiredAt)} ago.)`;
      return msg;
    }
    return 'Response ID has expired (10-minute TTL exceeded).';
  }

  if (reason === 'consumed') {
    return 'Response ID was already delivered to the calling session.';
  }

  // Unknown reason or older bridge that doesn't return one.
  if (issuedAt) {
    const age = now - issuedAt;
    if (age > 10 * 60 * 1000) {
      return `Response ID was issued ${formatDuration(age)} ago — likely expired (10-minute TTL).`;
    }
    return `Response ID not recognised by the bridge (issued ${formatDuration(age)} ago) — typo, or the bridge restarted since it was issued.`;
  }
  return (errBody && errBody.error) || 'Response not found or expired';
}

function cmdRespond(args) {
  const opts = parseArgs(args);

  if (opts.help || args.length === 0) {
    console.log(RESPOND_HELP);
    return;
  }

  const responseId = opts._[0];
  if (!responseId) {
    console.error('Error: Response ID required');
    process.exit(1);
  }

  const positionalData = opts._[1];
  const useStdinFlag = opts.stdin === true;

  if (positionalData !== undefined && useStdinFlag) {
    console.error('Error: Cannot combine a positional payload with --stdin. Pick one.');
    process.exit(1);
  }

  const doRespond = async () => {
    let responseData;

    const stdinIsTty = process.stdin.isTTY;
    const useStdin = useStdinFlag || (positionalData === undefined && !stdinIsTty);

    if (useStdinFlag && stdinIsTty) {
      console.error('Error: --stdin requires piped or redirected input.');
      console.error('Examples:');
      console.error('  echo "response" | sly-kanban respond <id> --stdin');
      console.error("  sly-kanban respond <id> --stdin <<'EOF'");
      console.error('  multi-line response here');
      console.error('  EOF');
      process.exit(1);
    }

    if (useStdin) {
      try {
        responseData = await readStdinUtf8();
      } catch (err) {
        console.error(`Error: Failed to read stdin: ${err.message}`);
        process.exit(1);
      }
      responseData = normalisePayload(responseData);
    } else if (positionalData !== undefined) {
      responseData = positionalData;
      if (containsShellHostileChars(responseData)) {
        console.error('warning: payload contains characters that may indicate shell expansion');
        console.error('         (backticks, $(, or unbalanced quotes). If the delivered bytes');
        console.error("         look wrong, use --stdin <<'EOF' ... EOF for safer delivery.");
      }
    } else {
      console.error('Error: Response data required.');
      console.error('Usage: sly-kanban respond <response-id> "your response data"');
      console.error("   or: sly-kanban respond <response-id> --stdin <<'EOF' ... EOF");
      process.exit(1);
    }

    if (responseData.length === 0) {
      console.error('Error: payload is empty.');
      console.error('If you intended to deliver an empty response, pass a non-empty placeholder');
      console.error('such as "no response" or "(none)" so the receiving agent has something to read.');
      process.exit(1);
    }

    const byteLength = Buffer.byteLength(responseData, 'utf8');
    const MAX_BYTES = 1024 * 1024;
    if (byteLength > MAX_BYTES) {
      console.error(`Error: payload is ${byteLength} bytes; max allowed is ${MAX_BYTES} bytes (1 MB).`);
      process.exit(1);
    }

    const bridgePort = process.env.BRIDGE_PORT || process.env.PORT || '3004';
    const bridgeUrl = process.env.BRIDGE_URL || `http://localhost:${bridgePort}`;

    try {
      const res = await fetch(`${bridgeUrl}/responses/${encodeURIComponent(responseId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: responseData }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error(`Error: ${formatRespondError(responseId, errBody)}`);
        process.exit(1);
      }

      const result = await res.json();
      const preview = sanitisePreview(responseData, 80);
      const lateSuffix = result.lateInjection ? ' (late injection — caller had already timed out)' : '';
      console.log(`Response delivered. (${byteLength} bytes — preview: "${preview}")${lateSuffix}`);
    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        console.error('Error: Bridge is not running.');
      } else {
        console.error('Error:', err.message);
      }
      process.exit(1);
    }
  };

  doRespond();
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  if (!command || command === '--help' || command === '-h') {
    console.log(MAIN_HELP);
    return;
  }

  switch (command) {
    case 'search':
      cmdSearch(commandArgs);
      break;
    case 'show':
      cmdShow(commandArgs);
      break;
    case 'board':
      cmdBoard(commandArgs);
      break;
    case 'create':
      cmdCreate(commandArgs);
      break;
    case 'update':
      cmdUpdate(commandArgs);
      break;
    case 'move':
      cmdMove(commandArgs);
      break;
    case 'reorder':
      cmdReorder(commandArgs);
      break;
    case 'archive':
      cmdArchive(commandArgs);
      break;
    case 'checklist':
      cmdChecklist(commandArgs);
      break;
    case 'problem':
      cmdProblem(commandArgs);
      break;
    case 'notes':
      cmdNotes(commandArgs);
      break;
    case 'status':
      cmdStatus(commandArgs);
      break;
    case 'automation':
      cmdAutomation(commandArgs);
      break;
    case 'prompt':
      cmdPrompt(commandArgs);
      break;
    case 'respond':
      cmdRespond(commandArgs);
      break;
    case 'areas':
      cmdAreas(commandArgs);
      break;
    default:
      console.error(`Error: Unknown command '${command}'`);
      console.log(MAIN_HELP);
      process.exit(1);
  }
}

main();
