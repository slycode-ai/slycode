---
name: design-requirements
version: 1.1.0
label: "Design Doc"
description: "Create a requirements document through iterative discovery"
group: "Card Actions"
placement: both
scope: global
classes:
  design: 10
---

{{cardContext}}

---

## Your Task

---
## Design Session

We're starting a **requirements discovery** session for card `{{card.id}}`. The goal is to create a design document that captures WHAT we're building and WHY - not HOW (unless architectural decisions are essential to the requirements).

**Your role is to investigate and advise.** You must NOT unilaterally cut scope, drop requirements, or decide what to build. All scope and direction decisions belong to the user. Present findings, options, and trade-offs — then ask.

> Card details are provided above. Run `sly-kanban show {{card.id}}` only if you need additional detail.

**Workflow:**

1. **Create design doc**: Use `/design {{card.title}}`
3. **Link to card**: After creating the doc, run:
   ```bash
   sly-kanban update {{card.id}} --design-ref "documentation/designs/<filename>.md"
   ```
4. **Add a design summary note on the card**:
   ```bash
   sly-kanban notes {{card.id}} add "Design summary: <key decisions, constraints, and open questions>" --agent "<your-agent-name>"
   ```
5. **Iterate**: Ask clarifying questions, present options, update the doc as we make decisions
6. **Complete**: When requirements are solid, assess the complexity and recommend next steps (see below)

**When design is complete — assess complexity:**

Look at the scope of work that came out of the design session:
- How many files need changing?
- Are there architectural decisions, new patterns, or cross-cutting concerns?
- Is the implementation path obvious from the design doc alone?

**If simple** (few files, straightforward changes, clear implementation path):
- Recommend **skipping the feature spec** and moving straight to implementation
- Explain why you think it's simple enough
- If I agree, move the card directly:
  ```bash
  sly-kanban move {{card.id}} implementation
  ```

**If any real complexity** (multiple components, non-obvious implementation, trade-offs in approach, new patterns):
- Recommend creating a **feature spec** with `/feature`
- If I agree, create it, link it, and move the card:
  ```bash
  sly-kanban update {{card.id}} --feature-ref "documentation/features/<filename>.md"
  sly-kanban move {{card.id}} implementation
  ```

When in doubt, lean toward creating the feature spec — it's better to over-document than to start implementation without a plan.

**Expectations:**
- Ask questions rather than assuming
- Present options when there are trade-offs
- Keep the document updated after each decision
- Focus on goals, constraints, and acceptance criteria
- Flag when you think the requirements are complete
- Do NOT unilaterally cut scope or drop requirements — the user decides what's in and out

**IMPORTANT — Surface everything in your message.** Do not assume the user has read the design document. Every time you respond, list in your conversation message:
- Any **outstanding questions** that need answers
- Any **options or trade-offs** that need a decision
- Any **suggestions** you want feedback on

Questions written into the doc but not surfaced in your message are effectively invisible.

---

**Start now** — begin the design session.
