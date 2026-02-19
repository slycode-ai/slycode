---
name: chore
version: 1.0.0
label: "Chore Plan"
description: "Create a chore plan for maintenance, bug fixes, or refactors"
group: "Card Actions"
placement: both
scope: global
classes:
  design: 40
---

{{cardContext}}

---

## Your Task

Create a **chore plan** for this card - a structured plan for maintenance work, bug fixes, or refactoring.

> Card details are provided above. Run `sly-kanban show {{card.id}}` only if you need additional detail.

If there's a design_ref, read that document for context.

**Context priming:** If you haven't already, use `/context-priming` with the card's **Areas** to understand the relevant codebase before planning.

**Then create the chore plan:**
/chore {{card.title}}

**After creating**, link the chore plan to the card:
```bash
sly-kanban update {{card.id}} --feature-ref "documentation/chores/<filename>.md"
```
