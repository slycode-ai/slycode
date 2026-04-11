---
name: challenge-implementation
version: 1.0.0
label: "Challenge Impl"
description: "Send implementation to another AI provider for adversarial code review and methodology analysis"
group: "Card Actions"
placement: both
scope: global
classes:
  testing: 30
---

{{cardContext}}

---

## Your Task — Challenge Implementation

You are initiating a **cross-agent implementation challenge** for card `{{card.id}}`. The goal is to send the completed implementation to a different AI provider for adversarial code review and methodology analysis, then synthesize their feedback.

---

### Phase 1 — Gather Context

1. **Read the full card details** (notes, problems, checklist):
   ```bash
   sly-kanban show {{card.id}}
   ```

2. **Prime area context** — use `/context-priming` with the card's **Areas** to understand the codebase architecture and patterns.

3. **Read the design document** (if linked):
   {{#if card.design_ref}}
   Read `{{card.design_ref}}`
   {{/if}}

4. **Read the feature spec** (if linked):
   {{#if card.feature_ref}}
   Read `{{card.feature_ref}}`
   {{/if}}

5. **Identify the changed files** — use git to find what was changed for this card:
   ```bash
   git log --oneline --all | head -20
   ```
   Look at recent commits related to this card's work. Read the key files that were added or modified.

6. **Read all card notes** — these contain implementation context and prior agent observations.

---

### Phase 2 — Determine Target Provider

Send the challenge to a **different** provider than yourself.

- If you are **Claude** → send to `codex`
- If you are **Codex** → send to `claude`
- If you are **Gemini** → try `claude` first; if that fails, try `codex`

To determine who you are: Claude models start with "claude-", Codex/OpenAI models are o3, o4-mini, codex-mini, etc., Gemini models start with "gemini-".

---

### Phase 3 — Prepare and Send

Before sending, optionally add a context note:

```bash
sly-kanban notes {{card.id}} add "Implementation challenge context: <summary of what was built, key files, architectural decisions>" --agent "<your-provider-name>"
```

Now construct a detailed prompt for the other agent. The prompt must include:

1. **The design document content** (paste inline) so they know what was intended
2. **The feature spec content** if one exists (paste inline)
3. **The key implementation files** — paste the actual code of the most important changed/added files. Focus on the core logic, not boilerplate.
4. **A file list** of everything that was changed, so they can request more if needed
5. **Key notes from the card** that explain decisions made during implementation
6. **Clear instructions** asking the other agent to:

   **Code Quality Review:**
   - Analyse the code for bugs, logic errors, and edge cases
   - Evaluate error handling and failure modes
   - Check for security concerns (injection, XSS, auth gaps, data leaks)
   - Assess performance — unnecessary loops, missing caching, N+1 queries, memory leaks
   - Review naming, structure, and readability

   **Methodology Review:**
   - Does the implementation match the design intent? Any drift?
   - Are the chosen patterns and abstractions appropriate?
   - Is there unnecessary complexity that could be simplified?
   - Are there better approaches that would achieve the same goals?
   - Is the code testable? Are there untested critical paths?
   - Does it follow the existing codebase conventions?

   **Perspective Analysis:**
   - Review from the perspective of a future maintainer reading this code for the first time
   - Consider what happens when requirements change — how rigid or flexible is this?
   - Think about what could go wrong in production under real usage patterns

   - Use `sly-kanban respond <response-id> "..."` to send back a structured response

**Send the prompt:**

```bash
sly-kanban prompt {{card.id}} "<your constructed prompt>" --provider <target-provider> --wait --timeout 180
```

Use `--timeout 180` (3 minutes). Do **not** use `--fresh`.

If the prompt times out, tell the user you're waiting — the response will arrive asynchronously.

---

### Phase 4 — Synthesize Feedback

When the response arrives, critically evaluate each point:

1. **Categorise each finding** as:
   - **Valid bug/issue** — real problem that should be fixed before approval
   - **Valid improvement** — correct observation, worth doing but not blocking
   - **Disagree** — you believe the implementation is correct, explain why
   - **Needs discussion** — legitimate trade-off, user should decide

2. **For valid bugs**: Fix them immediately or log as problems:
   ```bash
   sly-kanban problem {{card.id}} add "description" --severity <minor|major|critical>
   ```

3. **For valid improvements**: Propose the changes. If they're small, offer to make them now.

4. **For disagreements**: Explain your reasoning clearly.

5. **For ambiguous points**: Present both perspectives and ask the user.

6. **Add a summary note** to the card:
   ```bash
   sly-kanban notes {{card.id}} add "Implementation challenge complete: <N> bugs found, <N> improvements suggested, <N> disagreements, <N> need user input." --agent "<your-provider-name>"
   ```

7. **Present the synthesis to the user** with:
   - Any bugs that need fixing (blockers for approval)
   - Improvements worth making (non-blocking)
   - Disagreements with your reasoning
   - Open questions for the user

---

**Start now** — begin Phase 1.
