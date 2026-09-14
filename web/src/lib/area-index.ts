/**
 * context-priming area-index.md parser.
 *
 * KEEP IN SYNC with the canonical CLI implementation in scripts/kanban.js
 * (search for `function parseAreaIndex`). Both copies MUST return identical
 * results for the same input — `sly-kanban areas` and GET /api/areas are two
 * views of the same file. web/src/lib/area-index.test.ts is the parity test.
 *
 * An area entry is exactly the shape the context-priming template prescribes:
 *
 *   ### <name>
 *   - path: areas/<name>.md
 *
 * i.e. a level-3 heading whose next non-blank line starts with `- path:`.
 * Nothing else counts — not the `## Areas` grouping heading, not other
 * heading levels, not bold labels, not a `###` heading with no path line.
 * The `areas/` directory is NOT scanned: the index is canonical.
 *
 * Pure: no I/O. Returns unique names, sorted.
 */
export function parseAreaIndex(content: string): string[] {
  const lines = String(content).split(/\r?\n/);
  const areas: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = /^###\s+(\S+)\s*$/.exec(lines[i]);
    if (!heading) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && /^-\s+path:/.test(lines[j])) {
      const name = heading[1];
      if (!areas.includes(name)) areas.push(name);
    }
  }
  return areas.sort();
}
