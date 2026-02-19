---
name: review
version: 1.0.0
label: "Review Code"
description: "Review the implementation for code quality"
group: "Card Actions"
placement: startup
scope: global
classes:
  testing: 20
---

{{cardContext}}

---

## Your Task

Review the implementation for this card.

> Card details are provided above. If you need checklist status, notes from prior sessions, or problem IDs, run `sly-kanban show {{card.id}}` before proceeding.

**Context priming:** If you haven't already, use `/context-priming` with the card's **Areas** to understand the codebase patterns and review the changes in context.

**Review checklist:**
1. Code quality and best practices
2. Potential bugs or edge cases
3. Performance considerations
4. Security concerns
5. Documentation/comments adequate?

**Log any issues found:**
```bash
sly-kanban problem {{card.id}} add "description" --severity <minor|major|critical>
```

**Summary:** Overall assessment and any required changes before approval.
