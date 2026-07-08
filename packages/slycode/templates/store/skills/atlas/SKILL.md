---
name: atlas
version: 1.3.0
updated: 2026-07-03
description: "Build and maintain the Codebase Atlas for Code Mode: propose areas, write schema-validated explanation nodes via sly-atlas, declare collections for bulk file families, run staleness-driven refreshes PLUS a coverage crawl that enriches the thinnest area every run, and drive the Code Mode view with navigate/highlight/deck directives"
provider: claude
---

# Atlas Skill

You maintain the **Codebase Atlas** — the AI layer of SlyCode's Code Mode. The
atlas is a set of schema-validated JSON artifacts in `documentation/atlas/`
that the Code Mode UI renders as a zoomable system map with per-area
explanations. You NEVER edit those files directly: **every write goes through
`sly-atlas`**, which validates and rejects anything malformed. A rejected
write leaves the atlas untouched — fix the payload and retry.

## The contract

1. **You provide structure and meaning; the product renders it.** You never
   choose colors, positions, or layout.
2. **Only describe what exists.** `write-node` rejects any payload that names
   a file which doesn't exist on disk — check paths before writing.
3. **Refresh incrementally.** `sly-atlas status --json` tells you exactly
   which areas are stale and which files changed. Re-analyze ONLY those areas.
4. **Every run also crawls toward completeness.** Freshness ≠ done: a fresh
   node can still be thin. After handling stale areas, ALWAYS enrich the
   thinnest area (Workflow B step 5). The atlas must visibly grow every run
   until coverage is real — the UI tells users summaries fill in over time,
   and this rule is what makes that true.
5. **Describe families, not favourites.** Homogeneous collections (feature
   specs, chore plans, migrations, screenshots, generated files) get ONE
   module entry describing the whole family — never cherry-pick a single
   member as if it were special (see Collections rule below).
6. **Explanations serve a human overseer**, not a compiler: what the area IS,
   how it fits the whole, what its key files do — plain, specific prose.

## Commands

```bash
sly-atlas init                                # scaffold documentation/atlas/
sly-atlas status [--json]                     # staleness + coverage report — your work list
sly-atlas propose-areas --file <areas.json>   # write/replace the atlas root
sly-atlas write-node <areaId> --file <node.json>          # write/REPLACE an area node
sly-atlas write-node <areaId> --file <node.json> --merge  # ENRICH an area node (union, nothing dropped)
sly-atlas navigate <file[:line[-end]]> [--note "..."]
sly-atlas highlight <file:line[-end]> --note "..."
sly-atlas deck --file <deck.json>
```

`status` reports per-area **coverage** (described files / total files, plus the
largest undescribed files) — that is your enrichment work list. `--merge` is
the safe write mode for enrichment: existing content is preserved, your payload
wins on conflicts, and deleted files are pruned automatically.

Run from anywhere inside the project (root found via `documentation/kanban.json`).

## Workflow A — first scan (no atlas.json yet)

1. **Explore the codebase**: top-level directories, package manifests, entry
   points, existing docs (CLAUDE.md, README). Understand what the system IS.
2. **Propose 4–8 areas** — the top-level "buildings" of the map. Each area is
   a meaningful subsystem (e.g. "Web Command Center", "Terminal Bridge"), not
   a mirror of every directory. Write `areas.json`:

```json
{
  "project_overview": "One or two paragraphs: what this system is and how the pieces cooperate.",
  "areas": [
    { "id": "web", "name": "Web Command Center", "paths": ["web/src"], "summary": "One-liner shown on the map card." }
  ],
  "flows": [
    { "from": "web", "to": "bridge", "label": "PTY sessions / WS" }
  ]
}
```

   Rules: `id` is a slug (`[a-z0-9-]`, ≤32); `paths` are repo-relative dir
   prefixes (≤10 per area); ≤16 areas; ≤12 flows (only the load-bearing ones —
   the map is not a dependency graph). Run
   `sly-atlas propose-areas --file areas.json`.
3. **Write a node per area** (Workflow B step 3 format), freshest first.
4. Finish with `sly-atlas status` — everything should read `fresh`.

## Workflow B — incremental refresh (nightly / on demand)

1. `sly-atlas status --json` → the stale list, with exactly which described
   files changed. **Fresh areas: do not touch.**
2. For each stale area: read the changed files (and anything they newly pull
   in), update your understanding.
3. Write the node:

```json
{
  "explanation": "2-6 SHORT paragraphs separated by blank lines (\\n\\n in the JSON string): what this area does, how it hangs together, what talks to what. Plain prose for a human overseer — NEVER one unbroken wall of text; the UI renders each blank-line-separated block as its own paragraph. (≤8000 chars)",
  "key_files": [ { "path": "web/src/lib/scheduler.ts", "role": "automation firing" } ],
  "modules": [ { "path": "web/src/lib/scheduler.ts", "name": "scheduler", "summary": "Cron scan → verified prompt delivery into sessions." } ],
  "symbol_summaries": {
    "web/src/lib/scheduler.ts": { "isDue": "Decides whether an automation fires this tick.", "startScheduler": "Boots the HMR-safe interval loop." }
  },
  "sources": [ "web/src/lib/scheduler-notify.test.ts" ]
}
```

   - `key_files` (1–40): the files someone should know about, with a short role.
   - `modules` (≤80): the area's L1 "rooms" — one card each in the UI. Cover
     the important files, not every file.
   - `symbol_summaries` (≤60 files × ≤60 symbols): one-liners for the L3 file
     atlas. Prioritize big/central files. Symbol names must match the real
     definitions (the UI joins them against the deterministic symbol index).
   - `sources`: extra files you read that informed the explanation but aren't
     listed above — they get hash-stamped too, so changes to them mark the
     node stale.
   - The CLI stamps `source_hashes`, `updated_at`, `schema_version` itself.

   `sly-atlas write-node <areaId> --file node.json`
4. If area boundaries themselves changed (new subsystem, big refactor),
   re-run `propose-areas` with the full updated set. **Pinned areas (user
   renamed/pinned in the UI) must be kept — same `id`; the CLI preserves the
   user's name and rejects proposals that drop them.**
5. **Coverage crawl (MANDATORY, every run — even when nothing is stale):**
   look at the coverage numbers in `status --json`, pick the 1-2 thinnest
   areas, and enrich them with `write-node --merge`:
   - add symbol one-liners for ~3-6 more files (the `topUndescribed` list
     ranks the biggest gaps first — prioritize real source files),
   - add module cards for any load-bearing files that lack one,
   - declare `collections` for bulk families instead of skipping them — one
     declaration can close hundreds of files of false "gap" at zero cost.
   Keep it bounded (~15-40 new summaries per run) so runs stay cheap; over
   successive runs the atlas converges on full coverage. Do NOT rewrite fresh
   explanations — `--merge` exists so enrichment never loses anything.
6. End with `sly-atlas status` — confirm 0 stale and that coverage moved.
   Report a one-paragraph summary: what changed in the codebase since last
   refresh AND what you enriched.

## Collections rule

Not every file deserves its own card. For homogeneous families — numbered
feature specs, chore plans, questionnaires, migrations, screenshots, fixtures,
generated output — **declare a collection** in the node payload:

```json
"collections": [
  { "prefix": "documentation/features/", "summary": "76 numbered feature specs — the implementation contract per shipped feature." },
  { "prefix": "screenshots/", "summary": "Session screenshots pasted from terminals — noise, no analysis needed." }
]
```

What a declared collection does (all deterministic, enforced by the CLI):
- **Coverage**: every file under the prefix counts as described — the
  coverage crawl stops nagging about family members and points at REAL gaps.
- **Staleness**: the member LIST is hashed; adding/removing a family member
  marks the area stale, so "newest: 076"-style summaries get refreshed.
- **Validation**: an empty/typo'd prefix is rejected at write time.

Independently of declared collections, `write-node` auto-stamps each area's
own path prefixes the same way — so ANY file added or removed under an area
marks it stale on the next status check. New code can never sit invisible
waiting for the crawl; the nightly run will always be told about it.

Optionally ALSO add one module card for important families (pointed at a
representative file such as an index/README or the newest member) so the
family shows as a room on the map. Never list one member of a large family as
if it were the only one — that reads as arbitrary and wrong. Declare the
family, or for pure noise declare it with a "no analysis needed" summary.

## Workflow C — driving the view (ask-the-codebase sessions)

You may run in the **Atlas terminal**, side-by-side with the code panel.
**MANDATE — show, don't tell:** any request to see/show/find code or locations
("show me…", "where is…", "find all…") MUST produce a `deck` (multiple
results), `navigate` (single result), or `highlight` (a range) — never just a
path list printed in the terminal. A one-line terminal summary alongside is
fine; the view directive is the deliverable:

- Single location ("where is X defined?"):
  `sly-atlas navigate web/src/lib/scheduler.ts:943 --note "startScheduler — boots the loop"`
- A range worth reading ("what does this block do?"):
  `sly-atlas highlight web/src/lib/scheduler.ts:943-960 --note "HMR-safe start: clears stale interval, then ticks every 30s"`
- Multiple locations ("everywhere X is used"):
  ```json
  { "title": "submitVerified call sites", "items": [
    { "file": "web/src/components/CardModal.tsx", "line": 812, "note": "quick-launch prompt" },
    { "file": "web/src/lib/scheduler.ts", "line": 613, "note": "automation resume path" }
  ] }
  ```
  `sly-atlas deck --file deck.json`

These are one-shot directives: the UI renders them and the user clicks from
there (breadcrumb ← always returns them). Use real line numbers you verified
by reading the file — a wrong line number is worse than none. Keep decks ≤30
items and put the most relevant first.

## Failure handling

- `REJECTED` output lists exactly what's wrong — fix the payload, retry.
- `described file does not exist` — you hallucinated or mistyped a path.
  Verify with `ls`/`rg --files` before rewriting.
- Never work around a rejection by editing `documentation/atlas/` directly.
  If the CLI seems wrong, note it on the project's kanban board instead.
