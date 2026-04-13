---
name: challenge
version: 1.1.0
label: "Challenge"
description: "Send design to another AI provider for adversarial review and synthesis"
group: "Card Actions"
placement: both
scope: global
classes:
  design: 50
---

## Your Task — Challenge Design

Send the current design work for card `{{card.id}}` to a different AI provider for adversarial review, then synthesize their feedback.

---

### Phase 1 — Determine Target Provider and Send

**Use what you already have.** You most likely already have the card details, design doc, and notes in context from the current session. Don't re-read or re-fetch unless you genuinely lack something. If you do need card details, run `sly-kanban show {{card.id}}`.

**Pick the target provider** (must be different from yourself):
- **Claude** → send to `codex`
- **Codex** → send to `claude`
- **Gemini** → try `claude` first; if that fails, try `codex`

**Optionally** add a context note before sending:
```bash
sly-kanban notes {{card.id}} add "Challenge context: <brief summary of design state, key decisions, open questions>" --agent "<your-provider-name>"
```

**Construct a prompt** for the other agent that includes:
1. The design document content (paste inline — the other agent won't have it in context)
2. The feature spec content if one exists (paste inline)
3. Any relevant notes or decisions from the card
4. Clear instructions asking them to:
   - Review the design from as many perspectives as seem necessary (technical feasibility, user experience, edge cases, security, performance, simplicity, maintainability, etc.)
   - State what they **agree with** and why
   - State what they **disagree with** or see as risky, with specific reasoning
   - Suggest concrete improvements or alternatives where they see weakness
   - Call out any assumptions that seem unvalidated
   - Use `sly-kanban respond <response-id> "..."` to send back a structured response

**Send immediately:**
```bash
sly-kanban prompt {{card.id}} "<your constructed prompt>" --provider <target-provider> --wait --timeout 180
```

Do **not** use `--fresh` unless the user explicitly asks for it. Send to the existing session.

If the prompt times out, that's OK — tell the user you're waiting and the response will arrive asynchronously.

---

### Phase 2 — Synthesize Feedback

When the response arrives, **do not blindly adopt the suggestions**:

1. **Categorise each point** as:
   - **Agree** — valid concern, should be addressed
   - **Disagree** — current design is correct, explain why
   - **Needs discussion** — legitimate tension, user should decide

2. **For agreed points**: Go ahead and update the design document. Clearly state in your output what you changed and why.
3. **For disagreed points**: Explain your reasoning.
4. **For major scope changes or borderline calls**: Stop and ask the user before modifying the design. If a suggestion would significantly expand or redirect the scope, or if you're genuinely unsure whether to adopt it, surface it as a question rather than making the change.

5. **Update the design doc** with an "## External Review" section capturing who reviewed, agreements, disagreements, and open questions.

6. **Add a summary note**:
   ```bash
   sly-kanban notes {{card.id}} add "Challenge review complete: <N> agreed, <N> disagreed, <N> need user input. Design doc updated." --agent "<your-provider-name>"
   ```

7. **Present the synthesis to the user** — clearly list what you changed in the design, what you rejected and why, and any items that need their decision.

---

**Start now** — determine the target provider and send the challenge prompt.
