---
name: test-review
version: 1.0.0
label: "Test Review"
description: "Interactive test review — efficiently close out cards stuck in testing"
group: "Card Actions"
placement: both
scope: global
classes:
  testing: 90
---

{{cardContext}}

---

## Your Task

Run an **interactive test review** for this card. The goal is to efficiently determine if this card is ready to move to done — not to re-test everything, but to review what's been tested (explicitly or implicitly) and close the gaps.

**Step 1 — Gather full context:**
```bash
sly-kanban show {{card.id}}
```
Read the card description, checklist, problems, design_ref and feature_ref if they exist. Understand what this card was supposed to deliver.

**Step 1b — Prime area context:**
If you don't already have codebase context loaded for this card's areas, load it now:
Use `/context-priming` with the card's **Areas** to understand the relevant architecture and patterns. This helps you assess implicit testing more accurately.

**Step 2 — Assess checklist status:**
For each checklist item, categorise it:
- ✅ **Already checked** — done, skip it
- 🔍 **Implicitly tested** — evidence suggests this works (e.g., subsequent features depend on it, user asked about related functionality that wouldn't work if this was broken, problems were resolved and work continued)
- ❓ **Needs confirmation** — genuinely unclear, need to ask
- ⏭️ **Minor/deferrable** — low-risk item that can be noted and deferred

**Step 3 — Present your assessment:**
Show me a summary grouped by the categories above. For implicitly tested items, briefly explain your reasoning ("This works because X depends on it and X was working when we did Y").

**Step 4 — Quick Q&A (max 3 questions per round):**
For the ❓ items, ask me **up to 3 concise questions at a time**. The user communicates via voice/speech-to-text, so more than 3 is hard to answer in one go. Keep each question short and direct:
- "Did the kanban drag-drop work when you tested the wide viewport layout?"
- "Happy to defer the edge case testing for now?"
- "Was the search working when you used it from Telegram?"

If there are more than 3 items to ask about, do multiple rounds — ask 3, wait for answers, then ask the next batch.

I'll answer quickly and you adjust the categorisation.

**Step 5 — Take action:**
Based on our discussion:
1. **Check off** items that are done (explicitly or implicitly):
   ```bash
   sly-kanban checklist {{card.id}} toggle <item-id>
   ```
2. **Add a note** for any deferred/untested items explaining what wasn't fully verified:
   ```bash
   sly-kanban notes {{card.id}} add "Test Review: <item> deferred — <reason>"
   ```
3. **Resolve** any problems that are no longer relevant:
   ```bash
   sly-kanban problem {{card.id}} resolve <problem-id>
   ```

**Step 6 — Verdict:**
Give me a clear recommendation:
- **Ready for done** — all critical items verified, minor deferrals noted
- **Needs more work** — specific items still need attention (list them)

If ready, ask if I want to move to done:
```bash
sly-kanban move {{card.id}} done
```

**Guidelines:**
- Be efficient, not exhaustive. This is a review, not a fresh test.
- Always load area context first — it helps you reason about implicit testing.
- Lean toward "implicitly tested" when there's reasonable evidence.
- Don't make me confirm things that are obviously working.
- Max 3 questions per round — user answers via voice, keep it manageable.
- If everything looks clean, just say so and offer to move to done.
