---
name: implement
version: 1.0.0
label: "Implement"
description: "Implement the work described in the card"
group: "Card Actions"
placement: both
scope: global
classes:
  design: 80
  implementation: 10
---

{{cardContext}}

---

## Your Task

Implement the work described in this card.

> Card details are provided above. If you need checklist status, notes from prior sessions, or problem IDs, run `sly-kanban show {{card.id}}` before proceeding.

**Context priming:** If you haven't already, use `/context-priming` with the card's **Areas** to understand the relevant code.

**Then, based on what docs exist:**

First, move the card to implementation if its not already there. THen, 
1. **If feature_ref exists** → Read the feature spec and use `/implement` to execute the plan
2. **If only design_ref exists** → Read the design doc and implement based on the requirements there (no formal feature spec)
3. **If neither exists** → Work from the card description. Ask clarifying questions if requirements are unclear before proceeding.

**After implementation (required):**
1. Test your changes work as expected
2. Summarize what was done
3. Add a testing checklist to the card using checklist commands (do not replace checklist with notes):
   ```bash
   sly-kanban checklist {{card.id}} add "<primary behavior works>"
   sly-kanban checklist {{card.id}} add "<edge case validated>"
   sly-kanban checklist {{card.id}} add "<no regression observed>"
   ```
4. Mark any items that are already verified:
   ```bash
   sly-kanban checklist {{card.id}} list
   sly-kanban checklist {{card.id}} toggle <item-id>
   ```
5. Add an implementation summary note:
   ```bash
   sly-kanban notes {{card.id}} add "Implementation summary: <what changed, what was tested, what remains>" --agent "<your-agent-name>"
   ```
6. If you encounter issues, log them as problems
7. Move the card to testing if all went well
