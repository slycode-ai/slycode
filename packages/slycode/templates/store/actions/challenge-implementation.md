---
name: challenge-implementation
version: 1.1.0
label: "Challenge Impl"
description: "Send implementation to another AI provider for adversarial code review and methodology analysis"
group: "Card Actions"
placement: both
scope: global
classes:
  testing: 30
---

## Your Task — Challenge Implementation

Send the completed implementation for card `{{card.id}}` to a different AI provider for adversarial code review and methodology analysis, then synthesize their feedback.

---

### Phase 1 — Determine Target Provider and Send

**Use what you already have.** You most likely already have the card details, code, design docs, and implementation context from the current session. Don't re-read or re-fetch unless you genuinely lack something. If you do need card details, run `sly-kanban show {{card.id}}`.

**Pick the target provider** (must be different from yourself):
- **Claude** → send to `codex`
- **Codex** → send to `claude`
- **Gemini** → try `claude` first; if that fails, try `codex`

**Optionally** add a context note before sending:
```bash
sly-kanban notes {{card.id}} add "Implementation challenge context: <summary of what was built, key files, architectural decisions>" --agent "<your-provider-name>"
```

**Construct a prompt** for the other agent that includes:
1. The design document / feature spec content (paste inline) so they know the intent
2. The key implementation code — paste the actual source of the most important changed/added files (core logic, not boilerplate)
3. A file list of everything that was changed, so they can request more if needed
4. Key notes or decisions from the card that explain why things were done a certain way
5. Clear instructions asking them to review:

   **Code Quality:**
   - Bugs, logic errors, edge cases
   - Error handling and failure modes
   - Security concerns (injection, XSS, auth gaps, data leaks)
   - Performance (unnecessary loops, missing caching, N+1 queries, memory leaks)
   - Naming, structure, readability

   **Methodology:**
   - Does the implementation match the design intent? Any drift?
   - Are the patterns and abstractions appropriate?
   - Unnecessary complexity that could be simplified?
   - Better approaches that achieve the same goals?
   - Testability and untested critical paths
   - Adherence to existing codebase conventions

   **Perspective:**
   - Future maintainer reading this for the first time
   - What happens when requirements change — how rigid or flexible?
   - What could go wrong in production under real usage

   - Use `sly-kanban respond <response-id> "..."` to send back a structured response

**Send immediately:**
```bash
sly-kanban prompt {{card.id}} "<your constructed prompt>" --provider <target-provider> --wait --timeout 180
```

Do **not** use `--fresh` unless the user explicitly asks for it. Send to the existing session.

If the prompt times out, tell the user you're waiting — the response will arrive asynchronously.

---

### Phase 2 — Synthesize Feedback

**IMPORTANT: Do NOT make any code changes based on the feedback without the user's approval.** You may agree with findings and log problems, but all actual code modifications must be presented to the user first with a clear explanation of what you'd change and why. Wait for their go-ahead before touching any files.

When the response arrives, critically evaluate each point:

1. **Categorise each finding** as:
   - **Valid bug/issue** — real problem, should be fixed before approval
   - **Valid improvement** — worth doing but not blocking
   - **Disagree** — implementation is correct, explain why
   - **Needs discussion** — legitimate trade-off, user should decide

2. **For valid bugs**: Log as problems (do NOT fix yet):
   ```bash
   sly-kanban problem {{card.id}} add "description" --severity <minor|major|critical>
   ```

3. **For valid improvements**: Describe the proposed change and why it's worthwhile.
4. **For disagreements**: Explain your reasoning clearly.
5. **For ambiguous points**: Present both perspectives and ask the user.

6. **Add a summary note**:
   ```bash
   sly-kanban notes {{card.id}} add "Implementation challenge complete: <N> bugs, <N> improvements, <N> disagreements, <N> need user input." --agent "<your-provider-name>"
   ```

7. **Present the full synthesis to the user** with:
   - Bugs found — what they are, where, and your proposed fix for each
   - Improvements — what you'd change and why
   - Disagreements with your reasoning
   - Open questions

Then **ask the user** which items to action. Only make code changes after they confirm.

---

**Start now** — determine the target provider and send the challenge prompt.
