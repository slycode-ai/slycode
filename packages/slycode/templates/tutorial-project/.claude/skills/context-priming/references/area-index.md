# Area Index

Updated: YYYY-MM-DD

This index is the first file the context-priming skill loads. It lists every
knowledge area for this project — what each one covers, when to load it, and
hard-won operational notes. It starts empty: populate it as you learn the
codebase, not up front.

## How to add an area

1. Create `areas/<name>.md` with the deep reference for that part of the
   codebase. A good area file has: a short overview, key files and what they
   do, patterns and invariants that must hold, and a "when to expand" section
   pointing at files worth opening for specific sub-tasks.
2. Add an entry to the **Areas** section below, following this exact shape
   (shown indented here — do not indent real entries):

       ### <area-name>
       - path: areas/<area-name>.md
       - updated: YYYY-MM-DD
       - load-when: <comma-separated keywords/phrases that should trigger loading this area>
       - notes:
         - <short actionable learnings — "when X, do Y" / "don't assume Z">

3. Keep each entry's `updated` date current whenever its area file changes,
   refine `load-when` keywords when an area fails to load at the right moment,
   and prune notes that no longer apply (max ~10 per area, quality over
   quantity).

Good starting areas follow the project's natural seams: frontend, backend/API,
data layer, build/deploy, testing. Create an area the first time work touches
that part of the codebase.

## Areas

_None yet — add the first area when work requires codebase knowledge worth
keeping._
