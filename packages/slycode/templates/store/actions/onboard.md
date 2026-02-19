---
name: onboard
version: 1.0.0
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

**Do this:**
1. Analyze the card - understand the intent from title and description
2. Improve the title - make it clear, concise, action-oriented
3. Rewrite the description - structure logically, capture the essential gist
4. Set appropriate areas (run `sly-kanban areas` to see options)
4.5 Potentially use context-priming to understand that area better
5. Set correct type and priority
6. Apply all changes with `sly-kanban update {{card.id}} --title "..." --description "..." --areas "..." --type ... --priority ...`
7. Move to design: `sly-kanban move {{card.id}} design`

**Then explain:**
- What you understood the intent to be
- What changes you made and why
- Ask for confirmation - if I disagree, I'll tell you what to adjust
# test change
# user edit
