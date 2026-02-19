---
name: quick-fix
version: 1.0.0
label: "Quick Fix"
description: "Make a small fix without full design cycle"
group: "Card Actions"
placement: startup
scope: global
cardTypes:
  - "bug"
  - "chore"
---

{{cardContext}}

---

## Your Task

This is a **quick fix** - a small change that doesn't need a full design cycle.

> Card details are provided above. Run `sly-kanban show {{card.id}}` only if you need additional detail.

**Context priming:** If you haven't already, use `/context-priming` with the card's **Areas** to understand the relevant code. Even for quick fixes, context helps avoid mistakes.

**Then:**
1. Understand what needs to be fixed
2. Make the fix
3. Verify it works
4. Summarize the change

If this turns out to be more complex than expected, let me know and we can create a proper design doc.
