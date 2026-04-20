---
name: context
version: 1.0.0
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
