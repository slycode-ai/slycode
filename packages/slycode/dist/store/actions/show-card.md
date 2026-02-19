---
name: show-card
version: 1.0.0
label: "Show Card"
description: "Display complete card details"
group: "Utilities"
placement: both
scope: global
classes:
  backlog: 30
  design: 80
  done: 40
  implementation: 70
  testing: 70
---

Show the full details of this card:
```bash
sly-kanban show {{card.id}}
```
