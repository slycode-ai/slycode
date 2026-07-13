---
name: atlas
version: 1.4.3
updated: 2026-07-13
description: "Build and maintain the Codebase Atlas for Code Mode: propose areas, write schema-validated explanation nodes via sly-atlas, declare collections for bulk file families, run staleness-driven refreshes PLUS a coverage crawl that enriches the thinnest area every run, generate the catch-up digest, author guided tours, annotate database schemas, serve atlas context to agents, and drive the Code Mode view with navigate/highlight/deck directives"
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
7. **Ground yourself before analyzing.** If the project ships a
   context-priming skill (`.claude/skills/context-priming/`), load its area
   references for the areas you're about to touch — unless that context is
   already fresh in your session. It's the human-curated map; your analysis
   must build on it, not contradict or rediscover it.

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
sly-atlas write-digest --file <digest.json>   # catch-up digest (Workflow B step 7)
sly-atlas write-tour --file <tour.json>       # guided tour (Workflow D)
sly-atlas delete-tour <id>
sly-atlas db [--json]                         # deterministic DB introspection (read)
sly-atlas write-db --file <db.json>           # DB annotations (Workflow E)
sly-atlas context [--area <id>] [--files a,b] [--json] [--budget <chars>]  # agent context (Workflow F)
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
7. **Catch-up digest (every run, after everything else):** `status --json`
   includes a `digest` block — `anchorCommit` (the commit the user last
   acknowledged in Code Mode), `commitsSince`, and `perArea` commit counts.
   - `current: true` (digest already covers anchor..HEAD), `commitsSince`
     0, or `anchorCommit` null → skip, done.
   - Otherwise read `git log --stat <anchorCommit>..HEAD`, then write the
     digest — plain-English "what changed since you last looked", per area:

```json
{
  "headline": "One line: the gist of everything since the user last looked (≤300 chars).",
  "areas": [
    { "area": "web", "summary": "2-4 sentences of plain prose: what actually changed and why it matters.", "commits": 12, "files_changed": 9 }
  ],
  "notable": [
    { "file": "web/src/lib/atlas/store.ts", "line": 40, "note": "New view-state engine — worth a skim." }
  ]
}
```

   `sly-atlas write-digest --file digest.json` — the CLI stamps the anchor,
   dates, and HEAD itself. Only include areas that actually changed; order by
   importance. The digest REPLACES the previous one and always covers
   anchor..HEAD — regenerating daily while the user is away is correct (the
   anchor doesn't move until they press Mark read). Stay honest: describe
   the commits that exist, never pad. `stale tours` from `status --json`
   should be refreshed in the same run (Workflow D).

8. **Stale tours:** `status --json` lists tours with `stale: true` and which
   files changed. Re-read those step anchors; if the code moved, rewrite the
   tour (same id) with corrected lines/bodies via `write-tour`. If the tour's
   subject no longer exists, `delete-tour <id>`.

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

**Overlapping area paths are fine** (e.g. one area's path subsumes part of
another's). When files under your area actually belong to another area's
story, declare a POINTER collection for that prefix ("owned by <area> — see
its node") so coverage stays honest without duplicating analysis.

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

## Workflow D — guided tours

Tours are step-through walkthroughs the UI plays back fully client-side.
Author one when the user asks ("give me a tour of the messaging pipeline"),
or refresh stale ones during the nightly run (Workflow B step 8).

```json
{
  "id": "messaging-pipeline",
  "title": "How a Telegram message becomes a terminal prompt",
  "prompt": "Explain how an inbound Telegram message ends up as a prompt in a card's terminal session.",
  "description": "Follow one inbound message end to end.",
  "area": "messaging",
  "steps": [
    { "file": "messaging/src/index.ts", "line": 42, "endLine": 80,
      "title": "The webhook entry", "body": "1-3 short paragraphs explaining THIS anchor. The user sees the code next to it — explain, don't quote." }
  ]
}
```

`sly-atlas write-tour --file tour.json` — id is the filename slug; 2-30
steps; every step file must exist (verified line numbers — read the file
first; a wrong anchor is worse than none). Source hashes are stamped so the
tour goes stale exactly like a node when its files change. Good tours follow
one thread (a request's path, a subsystem's lifecycle) rather than listing
files. Mid-tour user questions arrive in the Atlas terminal automatically —
answer them with the step context in mind.

**The `prompt` field is the tour's lifecycle anchor.** It records the QUESTION
the tour answers, independent of any specific lines of code. Always set it
when authoring (derive one from the user's request). When a tour goes stale
or the user hits its ⟳ Refresh button (the request arrives in the Atlas
terminal), regenerate by **re-answering the prompt against the current code**
— re-read the relevant files, find the best anchors NOW, and `write-tour`
with the same id and the same prompt. Never just bump line numbers to silence
staleness: if the code changed enough that the old steps mislead, restructure
the steps. If the subject no longer exists, `delete-tour` and tell the user
why. Step bodies are disposable; the prompt is not.

## Workflow E — DB schema annotations

`sly-atlas status` reports detected database sources (SQLite files,
schema.prisma, CREATE TABLE .sql). When sources exist and annotations are
missing or the schema changed:

1. `sly-atlas db --json` — the deterministic introspection (tables, columns,
   pks, fks). This is exactly what the UI renders; you annotate MEANING.
2. Write annotations — what tables represent, what non-obvious columns mean,
   the relationships that matter:

```json
{
  "summary": "1-2 paragraphs: what this database is for, how the pieces relate.",
  "tables": { "users": { "summary": "One row per account.", "columns": { "anchor_commit": "last acknowledged git HEAD" } } },
  "relations": [ { "from": "orders", "to": "users", "label": "buyer" } ]
}
```

`sly-atlas write-db --file db.json`. Annotate what needs explaining, not
every column — obvious columns (id, created_at) earn nothing.

## Workflow F — atlas as agent context

`sly-atlas context` assembles a deterministic, token-bounded brief from the
atlas for OTHER agents (and yourself): project overview + areas
(`--area <id>` for one area's explanation/key files/symbols; `--files a,b`
for per-file context; `--json` for machine shape; `--budget <chars>`,
default 6000). Point agents at it instead of pasting atlas JSON — it reads
the same artifacts the UI renders, so it is always current. It complements
context-priming (curated notes); the atlas brief is the generated map.

## Failure handling

- `REJECTED` output lists exactly what's wrong — fix the payload, retry.
- `described file does not exist` — you hallucinated or mistyped a path.
  Verify with `ls`/`rg --files` before rewriting.
- Never work around a rejection by editing `documentation/atlas/` directly.
  If the CLI seems wrong, note it on the project's kanban board instead.
