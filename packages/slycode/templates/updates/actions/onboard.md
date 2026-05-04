---
name: onboard
version: 1.2.0
label: "Onboard"
description: "Analyze and improve a backlog item, then move to design"
group: "Card Actions"
placement: both
scope: global
classes:
  backlog: 10
---

{{cardContext}}

---

## Your Task

Onboard this backlog item. Analyze it, improve it, and move it to design.

> Card details are provided above. Run `sly-kanban show {{card.id}}` only if you need additional detail.

**Load the kanban skill if you don't already have it in memory** — it covers the CLI surface, card lifecycle, areas/types/priorities, status line, notes, and questionnaires. Without it you'll flounder on the SlyCode workflow primitives needed to do a clean onboarding.

**Do this:**
1. Analyze the card - understand the intent from title and description
2. Improve the title - make it clear, concise, action-oriented
3. Rewrite the description - structure logically, capture the essential gist. **Do not add new solutions or implementation suggestions** — that belongs in the design phase. However, preserve any solution ideas already present in the original description.
4. Set appropriate areas (run `sly-kanban areas` to see options)
4.5 Potentially use context-priming to understand that area better
5. Set correct type and priority
6. Apply all changes with `sly-kanban update {{card.id}} --title "..." --description "..." --areas "..." --type ... --priority ...`
7. Move to design: `sly-kanban move {{card.id}} design`

**Then explain:**
- What you understood the intent to be
- What changes you made and why
- Ask for confirmation - if I disagree, I'll tell you what to adjust
