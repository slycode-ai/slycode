'use client';

/**
 * Cross-project atlas rollup (feature 079) — the Dashboard's Atlas tab.
 *
 * One card per registered project: overview snippet, colored area chips with
 * amber staleness rings, digest headline when a catch-up is pending. Click
 * lands in that project's Code Mode. Read-only — per-project atlases stay
 * the source of truth.
 */

import { useEffect, useState } from 'react';

interface RollupArea {
  id: string;
  name: string;
  color?: string;
  summary?: string;
  stale: boolean;
}

interface ProjectRollup {
  projectId: string;
  name: string;
  hasAtlas: boolean;
  overview?: string;
  updatedAt?: string;
  areas: RollupArea[];
  staleCount: number;
  tourCount: number;
  digestHeadline?: string;
  digestGeneratedAt?: string;
  error?: string;
}

function relAge(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return null;
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'under an hour ago';
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AtlasRollup() {
  const [projects, setProjects] = useState<ProjectRollup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/atlas/rollup')
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { if (!cancelled) setProjects(d.projects); })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <p className="py-12 text-center text-sm text-red-500 dark:text-red-400">{error}</p>;
  }
  if (!projects) {
    return <p className="animate-pulse py-12 text-center text-sm text-void-400">Reading atlases across the workspace…</p>;
  }

  const scanned = projects.filter(p => p.hasAtlas);
  const unscanned = projects.filter(p => !p.hasAtlas);

  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-2">
        {scanned.map(p => (
          <a
            key={p.projectId}
            href={`/project/${p.projectId}?view=code`}
            className="group rounded-xl border border-void-200 bg-white p-4 shadow-(--shadow-card) transition-all hover:-translate-y-0.5 hover:border-neon-blue-400/40 hover:shadow-[0_8px_30px_rgba(0,0,0,0.18)] dark:border-void-700 dark:bg-void-850 dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.7)]"
          >
            <div className="flex items-baseline gap-2">
              <h3 className="text-base font-semibold text-void-950 transition-colors group-hover:text-neon-blue-500 dark:text-void-100 dark:group-hover:text-neon-blue-400">
                {p.name}
              </h3>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-void-400">
                {p.areas.length} areas{relAge(p.updatedAt) ? ` · ${relAge(p.updatedAt)}` : ''}
              </span>
            </div>

            {p.digestHeadline && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-neon-blue-500 dark:text-neon-blue-400">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
                <span className="line-clamp-1">{p.digestHeadline}</span>
              </p>
            )}

            {p.overview && (
              <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-void-500 dark:text-void-400">
                {p.overview}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.areas.map(a => (
                <span
                  key={a.id}
                  title={`${a.name}${a.summary ? ` — ${a.summary}` : ''}${a.stale ? ' (stale)' : ''}`}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-void-600 dark:text-void-300 ${
                    a.stale
                      ? 'border-amber-400/50 bg-amber-400/10'
                      : 'border-void-200 dark:border-void-700'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.color ?? '#4cb8f0' }} />
                  {a.name}
                </span>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-void-400">
              {p.staleCount > 0
                ? <span className="text-amber-500 dark:text-amber-400">{p.staleCount} stale</span>
                : <span className="text-emerald-500 dark:text-emerald-400">all fresh</span>}
              {p.tourCount > 0 && <span>{p.tourCount} tour{p.tourCount === 1 ? '' : 's'}</span>}
              <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">open Code Mode →</span>
            </div>
          </a>
        ))}
      </div>

      {unscanned.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-void-500 dark:text-void-400">Not scanned yet</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {unscanned.map(p => (
              <a
                key={p.projectId}
                href={`/project/${p.projectId}?view=code`}
                className="rounded-xl border border-dashed border-void-300 p-3.5 transition-colors hover:border-neon-blue-400/40 dark:border-void-700"
              >
                <h3 className="text-sm font-medium text-void-700 dark:text-void-300">{p.name}</h3>
                <p className="mt-1 text-[12px] text-void-400 dark:text-void-500">
                  {p.error ? p.error : 'No atlas — open Code Mode and run the first scan.'}
                </p>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
