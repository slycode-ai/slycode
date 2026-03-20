---
name: context-priming
version: 1.1.1
updated: 2026-02-22
description: Dynamic context provider for codebase knowledge. This skill should be used when working on code, answering questions about architecture, or making changes that require understanding of project structure. Maintains area-specific reference files that are loaded on demand. Self-updating based on observed drift between references and actual code. Load this skill early in work sessions - it contains essential workflow and update protocols.
---

# Context Priming

Provide dynamic, accurate context about this project's architecture and code. Load knowledge on demand, update when drift is observed, self-improve based on experience.

## When to Invoke

**Load context when:**
- Starting work requiring codebase knowledge not in current conversation
- Making changes to unfamiliar areas
- Answering questions about project architecture or patterns
- User asks about functionality and current context is insufficient

**Do NOT load when:**
- Information is clearly present from last 3-5 exchanges
- Task is trivial and doesn't require architectural understanding
- Already loaded relevant areas in this session (unless significant time/work has passed)

## How to Use

1. **Load area-index.md first** - understand available areas, their update dates, load-when triggers
2. **Load relevant area(s)** - based on current task and index guidance
3. **Follow area's "when to expand"** - each area indicates when to open specific files
4. **Evaluate freshness** - compare area's `updated` date against today (from system prompt); consider git activity if concerned

## Callouts

Prefix operational updates with `Priming:` to signal skill activity. Keep brief - one line.

**When to call out:**
- Loading an area: `Priming: Loading backend - API work detected.`
- Loading multiple: `Priming: This spans backend and database areas, loading both.`
- Staleness concern: `Priming: backend looks stale (Nov 20), will verify as I go.`
- Making a note: `Priming: Quick note added - auth order matters.`
- Skipping load: `Priming: Already have frontend context from earlier.`

**Don't call out:** Every file read, minor internal decisions, routine checks.

## Update Behavior

| Situation | Action |
|-----------|--------|
| Loaded info contradicts code in misleading way | Update reference in stride |
| Minor drift, no practical impact | Let it slide |
| Unsure if update needed | Note concern, ask at end of task |
| Multiple areas need restructuring | Consult user before proceeding |
| New feature added affecting an area | Update area reference |
| User says "context priming needs to know this" | Capture in relevant area |
| User says "you should have known this" | Analyze failure, propose fix (see below) |

**Small updates**: Make concisely, in stride, no announcement needed.
**Large restructuring/defrag**: Consult first. See `references/maintenance.md`.

## "You Should Have Known" Response

When user indicates priming failed:

1. **Identify cause**: Which of these?
   - Area not loaded when it should have been (bad load-when criteria)
   - Area loaded but info missing (incomplete reference)
   - Info existed but outdated (stale reference)
   - Area doesn't exist (missing area)
   - Judgment call to skip loading was wrong (bad heuristic)

2. **Propose fix** based on cause:
   - Content/index updates → do in stride
   - SKILL.md or maintenance.md changes → explain problem, propose change, await approval

3. **Surface immediately** - don't wait for task end. User will indicate if disruptive.

## Permission Model

| File | Permission |
|------|------------|
| references/areas/*.md | Update in stride |
| references/area-index.md | Update in stride |
| Add/remove/split areas | Suggest, light confirmation |
| SKILL.md | Explain, propose, await approval |
| references/maintenance.md | Explain, propose, await approval |

## Git Usage

Use `git diff` or `git log` sparingly:
- Before major refactors to verify scope
- When user questions accuracy of loaded info
- To check activity since area's last update date when staleness suspected

Not for routine small changes.

## Context Compaction

No direct visibility into remaining context space. When user flags compaction is imminent, or after long exploration sessions: consider if valuable learnings should be captured before context is summarized.

## Self-Improvement

Area notes (in area-index.md) capture learnings:
- Up to 10 notes per area, quality over quantity
- Format: actionable guidance ("when X, do Y" or "don't assume Z")
- Remove notes that no longer apply
- If skill behavior is flawed, suggest improvement to user

If suggestion timing/frequency becomes disruptive, user will indicate - adjust accordingly.

## Operational Principles

- Concise updates: prefer short phrase tweaks over paragraph additions
- Don't bloat references - information density is the goal
- When on fence about loading, lean toward loading
- Trust the index's load-when triggers; refine them when wrong
- No hardcoded "status" - freshness is evaluated dynamically

## Skill Location & Cross-Provider Note

**Canonical path (relative to project root):**
```
.claude/skills/context-priming/
├── SKILL.md                        # This file
├── references/
│   ├── area-index.md               # Index of all areas (load first)
│   ├── maintenance.md              # Defrag, pruning, area separation doctrine
│   └── areas/
│       └── [name].md               # Deep reference per area
```

**Resolution order — try these paths in order, use the first that exists:**

1. **Primary:** `<project-root>/.claude/skills/context-priming/` — the canonical, most up-to-date copy. Always check here first.
2. **Fallback:** The directory containing this SKILL.md (i.e. your own skill folder). If there is no `.claude/` directory in the project, the references were likely copied alongside this file.

This matters when the skill is deployed to another provider (Codex at `.agents/skills/`, Gemini at `.gemini/skills/`). Those folders may contain just this SKILL.md for discovery, with the area files living in `.claude/`. But if the project has no `.claude/` directory at all (e.g. a pure Codex or Gemini project), fall back to reading from your own skill directory.

**Resolved paths (primary):**
- **Area index:** `<project-root>/.claude/skills/context-priming/references/area-index.md`
- **Area files:** `<project-root>/.claude/skills/context-priming/references/areas/<name>.md`
- **Maintenance:** `<project-root>/.claude/skills/context-priming/references/maintenance.md`

**Resolved paths (fallback — relative to this SKILL.md):**
- **Area index:** `./references/area-index.md`
- **Area files:** `./references/areas/<name>.md`
- **Maintenance:** `./references/maintenance.md`

## Files

- `references/area-index.md` - compact index of all areas
- `references/maintenance.md` - defrag, pruning, area separation doctrine
- `references/areas/[name].md` - deep reference per area
