# Maintenance Doctrine

Rules for maintaining context-priming references. Changes to this file require user approval.

## Area File Structure

Area files should be as lean as the area requires. Include sections that add value; omit those that don't.

**Always include:**
```markdown
# [Area Name]

Updated: YYYY-MM-DD

## Overview
What this area does, boundaries. 2-3 sentences.

## Key Files
- `file.py` - purpose
[Most important files/modules]

## When to Expand
- [task] → [files to open]
```

**Include when relevant:**

| Section | When to include |
|---------|-----------------|
| Key Functions | Area has important entry points, APIs, or non-obvious control flow |
| Data Models | Area defines data structures used internally or externally |
| Shared Objects | Area defines or consumes objects used across multiple areas |
| Patterns & Invariants | Area has critical rules that must hold |
| Interfaces | Area connects to other areas with data flow |

**Section formats (when used):**

```markdown
## Key Functions
- `process_message()` in handlers.py - entry point for incoming messages

## Data Models
- `Message` (models.py) - id, content, sender_id, timestamp | core envelope

## Shared Objects
- `Message` - DEFINED HERE, used by: frontend, api, workers
- `Config` - defined in core, IMPORTED HERE

## Patterns & Invariants
- Auth middleware runs before handlers

## Interfaces
- → frontend: sends Message via WebSocket
- ← api: receives Request, returns Response
```

Keep area files under 200 lines. Simple areas may be 20-30 lines; complex areas will be longer.

**Shared Objects note**: When present, prevents duplicate definitions. Mark canonical location.

## Defragmentation

**When to defrag an area:**
- Information is scattered/duplicated within the file
- Sections contain outdated content mixed with current
- File has grown beyond 200 lines
- Reading the file doesn't quickly answer "what do I need to know?"

**Defrag process:**
1. Read the entire area file
2. Identify: duplicates, outdated info, poor organization
3. Consolidate related information
4. Remove obsolete content (don't comment it out - delete)
5. Verify remaining content is accurate against current code
6. Update the `Updated` date

**Consult user before defragging if:**
- Multiple areas need simultaneous restructuring
- Unsure whether information is obsolete or still relevant
- Defrag would take significant time

## Area Separation

**Heuristics for deciding areas:**
- Group by logical module/subsystem, not by file type
- An area should be loadable and useful independently
- If two areas are always loaded together, consider merging
- If an area covers unrelated concerns, consider splitting

**When to split an area:**
- File exceeds 200 lines despite being concise
- Contains distinct subsystems that don't interact
- Load-when triggers have diverged (some tasks need part A, others need part B)

**When to merge areas:**
- Two areas are nearly always loaded together
- Combined size would still be under 150 lines
- Separation creates artificial boundaries

**Cross-references:**
- Areas can note "see also: [other-area]" for related context
- Don't auto-load chains - let the index's load-when guide loading
- If area A heavily depends on area B, note this in A's Interfaces section

## Note Pruning

Notes in area-index.md capture learnings. Prune when:
- Note contradicts newer information (keep newer)
- Code changed and note no longer applies
- Note is vague or not actionable
- Area exceeds 10 notes

**Pruning is lightweight** - remove stale notes during routine updates, don't treat as separate task.

## New Project Initialization

When skill is introduced to a new codebase:

1. Clear `areas/` directory
2. Reset area-index.md to template state
3. Keep SKILL.md and maintenance.md intact
4. Scan project structure:
   - Look for obvious module boundaries (directories, packages)
   - Check build configs (package.json, pyproject.toml, etc.)
   - Read CLAUDE.md for existing documentation pointers
5. Propose 3-6 initial areas to user
6. After approval, create area files with initial discovery
7. Mark all as freshly created - validate through actual use
