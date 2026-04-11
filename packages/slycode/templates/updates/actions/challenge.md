---
name: challenge
version: 1.0.0
label: "Challenge"
description: "Send design to another AI provider for adversarial review and synthesis"
group: "Card Actions"
placement: both
scope: global
classes:
  design: 50
---

{{cardContext}}

---

## Your Task — Challenge Design

You are initiating a **cross-agent design challenge** for card `{{card.id}}`. The goal is to send the current design work to a different AI provider for adversarial review, then synthesize their feedback to strengthen the design.

---

### Phase 1 — Gather Context

1. **Read the full card details** (notes, problems, checklist):
   ```bash
   sly-kanban show {{card.id}}
   ```

2. **Read the design document** (if linked):
   {{#if card.design_ref}}
   Read `{{card.design_ref}}`
   {{/if}}

3. **Read the feature spec** (if linked):
   {{#if card.feature_ref}}
   Read `{{card.feature_ref}}`
   {{/if}}

4. **Read all card notes** — these contain cross-agent communication and prior context.

---

### Phase 2 — Determine Target Provider

You need to send the challenge to a **different** provider than yourself.

- If you are **Claude** → send to `codex`
- If you are **Codex** → send to `claude`
- If you are **Gemini** → try `claude` first; if that fails (no session / error), try `codex`

To determine who you are: check your model identity. Claude models start with "claude-", Codex models are OpenAI (e.g., o3, o4-mini, codex-mini), Gemini models start with "gemini-".

---

### Phase 3 — Prepare and Send

Before sending the prompt, you may optionally add a note to the card summarising key context that the other agent should know:

```bash
sly-kanban notes {{card.id}} add "Challenge context: <brief summary of design state, key decisions, open questions>" --agent "<your-provider-name>"
```

Now construct a detailed prompt for the other agent. The prompt must include:

1. **The full design document content** (paste it inline — the other agent may not have access to the file)
2. **The feature spec content** if one exists (paste inline)
3. **Key notes from the card** that provide relevant context
4. **Clear instructions** asking the other agent to:
   - Review the design from as many perspectives as seem necessary (technical feasibility, user experience, edge cases, security, performance, simplicity, maintainability, etc.)
   - State what it **agrees with** and why
   - State what it **disagrees with** or sees as risky, with specific reasoning
   - Suggest concrete improvements or alternatives where it sees weakness
   - Call out any assumptions that seem unvalidated
   - Use `sly-kanban respond <response-id> "..."` to send back a structured response

**Send the prompt:**

```bash
sly-kanban prompt {{card.id}} "<your constructed prompt>" --provider <target-provider> --wait --timeout 180
```

Use `--timeout 180` (3 minutes) to allow thorough analysis. Do **not** use `--fresh` — send to the existing session.

If the prompt times out, that's OK — the response will arrive asynchronously. Tell the user you're waiting and check back. The response will eventually come through.

---

### Phase 4 — Synthesize Feedback

When the response arrives, **do not blindly adopt the suggestions**. Instead:

1. **Categorise each point** as:
   - **Agree** — valid concern, should be addressed
   - **Disagree** — you believe the current design is correct, explain why
   - **Needs discussion** — legitimate tension, the user should decide

2. **For agreed points**: Propose specific changes to the design document.

3. **For disagreed points**: Explain your reasoning for why the current approach is sound.

4. **For ambiguous points**: Present both perspectives clearly and ask the user what they'd like to do.

5. **Update the design doc** with an "## External Review" section capturing:
   - Who reviewed (which provider)
   - Key agreements and changes made
   - Key disagreements and your reasoning
   - Open questions surfaced to the user

6. **Add a summary note** to the card:
   ```bash
   sly-kanban notes {{card.id}} add "Challenge review complete: <N> points agreed, <N> disagreed, <N> need user input. Design doc updated with External Review section." --agent "<your-provider-name>"
   ```

7. **Present the synthesis to the user** with clear recommendations and any decisions that need their input.

---

**Start now** — begin Phase 1.
