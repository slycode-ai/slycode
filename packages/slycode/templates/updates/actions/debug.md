---
name: debug
version: 1.0.0
label: "Debug"
description: "Debug issues described in a bug card"
group: "Card Actions"
placement: startup
scope: global
cardTypes:
  - "bug"
classes:
  testing: 10
---

{{cardContext}}

---

## Your Task

Debug the issues described in this bug card.

> Card details are provided above. If you need checklist status, notes from prior sessions, or problem IDs, run `sly-kanban show {{card.id}}` before proceeding.

**Context priming:** If you haven't already, use `/context-priming` with the card's **Areas** to understand the relevant code. This is critical for effective debugging.

**Then follow this process:**
1. **Understand** - What's the expected vs actual behavior?
2. **Reproduce** - Can we trigger the bug?
3. **Investigate** - Trace through the code to find the issue
4. **Root cause** - What's actually causing this?
5. **Fix** - Propose and implement a solution
6. **Verify** - Confirm the fix works

Log any related issues discovered with `sly-kanban problem {{card.id}} add "description"`
