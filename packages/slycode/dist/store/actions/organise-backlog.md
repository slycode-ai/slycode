---
name: organise-backlog
version: 1.0.0
label: "Organise Backlog"
description: "Analyse the backlog and recommend what to work on next, then reorder cards"
group: "Project"
placement: both
scope: global
classes:
  project-terminal: 90
---

{{projectContext}}

---

## Your Task

You are a **project strategist**. Analyse the full board state and help me decide what to work on next from the backlog.

**Step 1 — Gather the full picture:**

Get the full board snapshot with a single command:
```bash
sly-kanban board
```

This shows all cards (backlog, design, implementation, testing) with full details, grouped by stage. Automation cards and done cards are excluded by default.

**Step 2 — Analyse and strategise:**

With full context, assess each backlog card against these factors:

| Factor | Consider |
|--------|----------|
| **Strategic value** | Does this unlock other work, address a user-facing need, or move the project toward a key milestone? |
| **Dependencies** | Does anything in-flight need this first? Would this be blocked by something in-flight? |
| **Momentum** | Does this build on recently completed work while context is fresh? |
| **Risk reduction** | Does this address a known pain point, security issue, or technical debt that could bite later? |
| **Effort vs impact** | Quick wins vs large investments — what's the best return right now? |
| **Current workload** | What's already in-flight? Is there capacity for a big item or should we pick something small? |
| **Complementarity** | Would this card's work complement or conflict with what's in progress? |

**Step 3 — Present your recommendation:**

Present a **ranked shortlist** (top 3-5 cards) with reasoning for each:

1. **[Card Title]** (`card-id`) — Why this should be next. Reference how it relates to in-flight work if relevant.
2. ...

Also flag any cards that seem:
- **Stale or irrelevant** — should be archived or reconsidered
- **Too vague** — need onboarding/refinement before they're actionable
- **Blocked** — dependent on something that isn't done yet

**Step 4 — Get my input:**

Ask me:
- Do I agree with the top pick?
- Are there any priorities or context I haven't captured on the board?
- Any cards I want to deprioritise or remove?

Wait for my response before proceeding.

**Step 5 — Reorder the backlog:**

Once we've agreed on the priority order, reorder the backlog using the CLI:
```bash
sly-kanban reorder backlog <card-id-1> <card-id-2> <card-id-3> ...
```

List the card IDs in priority order (highest priority first). The command sets order values automatically and prints a confirmation of the new order.

Summarise the final ordering and what we decided should be tackled next.
