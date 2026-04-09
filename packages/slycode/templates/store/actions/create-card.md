---
name: create-card
version: 1.0.0
label: "New Card"
description: "Create a new kanban card"
group: "Project"
placement: startup
scope: global
classes:
  project-terminal: 50
---

{{projectContext}}

---

## Your Task

Help me create a new kanban card.

**I'll describe what I need, then you'll:**
1. Ask clarifying questions if needed
2. Suggest a clear title
3. Write a structured description
4. Recommend type (feature/bug/chore) and priority
5. Suggest relevant areas (run `sly-kanban areas` to see options)

**Then create the card:**
```bash
sly-kanban create --title "..." --description "..." --type <feature|bug|chore> --priority <low|medium|high|critical> --stage backlog
```

What would you like to create?
