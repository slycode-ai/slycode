---
name: approve
version: 1.0.0
label: "Approve"
description: "Approve and move to done"
group: "Card Actions"
placement: both
scope: global
classes:
  testing: 30
---

{{cardContext}}

---

## Your Task

I'm approving this card.

**Check for outstanding issues:**
```bash
sly-kanban problem {{card.id}} list
```

**If there are unresolved problems:**
- Warn me about them
- If I still want to proceed, resolve them all and note they were closed on approval

**Then move to done:**
```bash
sly-kanban move {{card.id}} done
```
