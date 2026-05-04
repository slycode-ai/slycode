---
name: context
version: 1.1.0
label: "Context"
description: "Load codebase context for relevant areas"
group: "Utilities"
placement: both
scope: global
classes:
  backlog: 20
  design: 100
  done: 30
  implementation: 50
  project-terminal: 10
  testing: 70
---

{{cardContext}}
{{projectContext}}

---

Load codebase context using `/context-priming`. If this is a card session, use the card's **Areas** to guide which areas to prime.

If you don't already have the **kanban skill** loaded in memory, load it now — it covers the CLI surface, card lifecycle, status line, notes, questionnaires, and cross-card prompts. Without it you'll flounder on the SlyCode workflow primitives.
