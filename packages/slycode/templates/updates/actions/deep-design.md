---
name: deep-design
version: 1.1.0
label: "Deep Design"
description: "Thorough design with parallel analysis agents for creative, risk, and quality perspectives"
group: "Card Actions"
placement: both
scope: global
classes:
  design: 20
---

{{cardContext}}

---

## Your Task

---
## Deep Design Session

We're starting a **deep design** session for card `{{card.id}}`. This is the thorough version — after creating the initial design doc, we'll run parallel analysis agents to stress-test the design from multiple angles before iterating.

**Your role is to investigate and advise.** You must NOT unilaterally cut scope, drop requirements, or decide what to build. All scope and direction decisions belong to the user. Present findings, options, and trade-offs — then ask.

---

### Phase 1 — Initial Design Doc

> Card details are provided above. Run `sly-kanban show {{card.id}}` only if you need additional detail.

1. **Create design doc**: Use `/design {{card.title}}`
3. **Link to card**:
   ```bash
   sly-kanban update {{card.id}} --design-ref "documentation/designs/<filename>.md"
   ```

**STOP here after creating and linking the design doc.** Do NOT start the Q&A iteration yet. Proceed to Phase 2.

---

### Phase 2 — Parallel Analysis Agents

Now launch sub-agents to analyse the design from different perspectives. Each agent receives the design doc content and card details.

**Before launching, assess relevance.** Not every agent applies to every design. Skip any that clearly don't fit the problem (e.g., UI Polish for a backend-only change, Edge Case Hunter for a simple cosmetic tweak). Briefly note which agents you're skipping and why.

**Launch the relevant agents in parallel using the Agent tool** (subagent_type: `general-purpose`). Each agent should:
- Read the design doc just created
- Read the card details
- If the card has Areas, use `/context-priming` with those areas for codebase awareness
- Return a focused brief (aim for 5-15 bullet points, not essays)
- **Advise only** — do not recommend cutting scope or dropping requirements. Flag risks and trade-offs, but respect the stated scope as given

Here are the 6 available perspectives:

#### 1. Out-of-the-Box Thinker
> You are a creative lateral thinker. Read the design doc and card details, then suggest alternative approaches, unconventional solutions, or angles the designer may not have considered. Think about whether the problem could be reframed, whether there's a simpler way to achieve the same goal, or whether there's an opportunity to solve a bigger problem at the same time. Be bold but practical — wild ideas are welcome if you can explain why they might work.

#### 2. Unintended Consequences Analyst
> You are a risk analyst. Read the design doc and card details, then identify potential unintended consequences, ripple effects, and things that could go wrong. Consider: What existing functionality might break? What assumptions might not hold? What happens if this feature is used differently than expected? What are the failure modes? Think about both technical and user-experience consequences.

#### 3. UI Polish Consultant
> You are a UI/UX polish expert. Read the design doc and card details, then evaluate the design through a visual quality lens. Consider: Will this feel modern, professional, and responsive? Are there layout edge cases (narrow viewports, long text, empty states, overflow)? Does it match existing UI patterns in the codebase? Are there micro-interactions, transitions, or visual details that would elevate the feel? Flag anything that might look unfinished or behave unexpectedly at different sizes.

#### 4. Prior Art Scout
> You are a codebase archaeologist. Read the design doc and card details, then search the existing codebase for related patterns, reusable components, utilities, or conventions. Use `/context-priming` with the card's Areas and explore the code. Report: What existing code can be reused? What patterns should this design follow for consistency? Are there similar features we can learn from? Is there anything we'd be duplicating unnecessarily?

#### 5. Simplification Advocate
> You are a complexity skeptic. Read the design doc and card details, then look for ways the *implementation* could be simpler while still meeting the stated requirements. For each design decision, ask: Could the implementation be simpler? Is there a less complex way to achieve this requirement? Are we over-engineering the solution? Propose concrete simplifications with clear trade-offs. **Important:** Do NOT recommend cutting requirements or reducing scope — the requirements are the user's decision. Focus on simpler ways to achieve what's been asked for.

#### 6. Edge Case Hunter
> You are a boundary condition specialist. Read the design doc and card details, then enumerate edge cases, boundary conditions, and scenarios the design should handle. Think about: empty/null/missing data, concurrent access, very large inputs, rapid repeated actions, permission boundaries, network failures, interrupted operations, first-use vs power-user flows. Rate each edge case by likelihood and severity.

---

### Phase 3 — Synthesis

Once the agents return, **synthesize** their findings:

1. Present a consolidated summary organised by theme (not by agent). Group related insights together.
2. For each insight, note the source perspective and classify as:
   - 🔴 **Must address** — would cause real problems if ignored
   - 🟡 **Should consider** — meaningful improvement or risk worth discussing
   - 🟢 **Nice to know** — interesting perspective, may inform decisions later
3. Update the design doc with a new **"Analysis Notes"** section capturing the key findings.
4. Present options and suggestions — do NOT unilaterally fold findings into requirements or cut scope. The user decides what to act on.

---

### Phase 4 — Iterative Q&A

Now begin the normal design iteration:
- Ask clarifying questions informed by the analysis
- Present options when there are trade-offs
- Update the design doc as decisions are made
- Focus on goals, constraints, and acceptance criteria

**IMPORTANT — Surface everything in your message.** Do not assume the user has read the design document. Every time you respond, list in your conversation message:
- Any **outstanding questions** that need answers
- Any **options or trade-offs** that need a decision
- Any **suggestions** you want feedback on

Questions written into the doc but not surfaced in your message are effectively invisible.

**When design is complete — assess complexity:**

Look at the scope of work:
- How many files need changing?
- Are there architectural decisions, new patterns, or cross-cutting concerns?
- Is the implementation path obvious from the design doc alone?

**If simple** (few files, straightforward, clear path):
- Recommend skipping the feature spec and moving to implementation
- If agreed: `sly-kanban move {{card.id}} implementation`

**If complex** (multiple components, non-obvious, trade-offs):
- Recommend creating a feature spec with `/feature`
- If agreed, create it, link with `--feature-ref`, and move to implementation

When in doubt, lean toward creating the feature spec.

---

**Start now** — begin Phase 1.
