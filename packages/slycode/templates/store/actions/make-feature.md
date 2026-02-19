---
name: make-feature
version: 1.0.0
label: "Feature Spec"
description: "Create a feature specification with implementation plan"
group: "Card Actions"
placement: both
scope: global
classes:
  design: 30
---

{{cardContext}}

---

## Your Task

Create a **feature specification** for this card - a detailed implementation plan.

> Card details are provided above. Run `sly-kanban show {{card.id}}` only if you need additional detail.

If there's a design_ref, read that document for requirements context.

**Context priming:** If you haven't already, use `/context-priming` with the card's **Areas** to understand the relevant codebase before planning.

**Then create the feature spec:**
/feature {{card.title}}

**After creating**, link the feature spec to the card:
```bash
sly-kanban update {{card.id}} --feature-ref "documentation/features/<filename>.md"
```

**Then add a short planning note to the card:**
```bash
sly-kanban notes {{card.id}} add "Feature spec summary: <scope, milestones, and key risks>" --agent "<your-agent-name>"
```
