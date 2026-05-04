---
name: debug
version: 1.1.0
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

---

### Asking Multiple Questions — Use a Questionnaire

If you need **3+ pieces of information** from the user to investigate (repro steps, environment, recent changes, expected vs actual, when it started, etc.), author a questionnaire instead of asking inline (skip if you're responding via messaging — ask inline instead):

1. Write JSON to `documentation/questionnaires/NNN_<slug>.json` (next available integer prefix)
2. Attach: `sly-kanban update {{card.id}} --questionnaire-ref documentation/questionnaires/NNN_<slug>.json`
3. Tell the user briefly in chat what you're trying to learn and why, then wait
4. The user's Submit lands in your session as a Q&A block

For 1-2 questions, ask inline.
