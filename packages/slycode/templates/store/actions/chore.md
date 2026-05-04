---
name: chore
version: 1.1.0
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

---

### Asking Multiple Questions — Use a Questionnaire

If clarifying scope/approach/risk needs **3+ related questions** before you can write the plan, author a questionnaire instead of asking inline (skip if you're responding via messaging — ask inline instead):

1. Write JSON to `documentation/questionnaires/NNN_<slug>.json` (next available integer prefix)
2. Attach: `sly-kanban update {{card.id}} --questionnaire-ref documentation/questionnaires/NNN_<slug>.json`
3. Tell the user briefly in chat what's in it and why, then wait
4. The user's Submit lands in your session as a Q&A block

For 1-2 questions, ask inline. See the kanban skill for the schema and item types.
