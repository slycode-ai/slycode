---
name: test-review
version: 1.1.0
label: "Test Review"
description: "Interactive test review — efficiently close out cards stuck in testing"
group: "Card Actions"
placement: both
scope: global
classes:
  testing: 100
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

**Step 4 — Quick Q&A:**

For the ❓ items, choose the right delivery based on how many you have:

- **1-3 questions** — ask inline, concise and direct (the user replies via voice/speech-to-text):
  - "Did the kanban drag-drop work when you tested the wide viewport layout?"
  - "Happy to defer the edge case testing for now?"
  - "Was the search working when you used it from Telegram?"

- **4+ questions** — author a questionnaire instead (unless you're responding via messaging, in which case ask inline anyway). Voice replies don't scale beyond ~3 questions, but a questionnaire lets the user fill at their own pace using proper input controls (boolean toggles, single_choice, etc.):
  1. Write JSON to `documentation/questionnaires/NNN_<slug>.json` (next available integer prefix)
  2. Use `boolean` items for "did this work?" questions; `single_choice` with `allow_other: true` for "verified / deferred / broken / not sure"; `free_text` for anything open-ended
  3. Attach: `sly-kanban update {{card.id}} --questionnaire-ref documentation/questionnaires/NNN_<slug>.json`
  4. Tell the user briefly in chat what's in it, then wait
  5. The user's Submit lands in your session as a Q&A block — use the answers to adjust categorisation

I'll answer (inline or via questionnaire) and you adjust the categorisation.

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
- 1-3 questions inline; 4+ → questionnaire (user answers via voice, keep inline manageable).
- If everything looks clean, just say so and offer to move to done.
