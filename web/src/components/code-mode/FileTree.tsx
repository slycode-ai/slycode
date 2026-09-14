'use client';

/**
 * Code Mode — file tree rail (Phase 1). Secondary navigation by design.
 *
 * Two-layer expansion state (Greg's testing feedback):
 * - USER layer (durable): dirs the user explicitly opened stay open; dirs the
 *   user explicitly closed stay closed — surviving navigation.
 * - AUTO layer (ephemeral): when navigation activates a file (atlas click,
 *   symbol jump, search hit, AI navigate), its ancestor dirs auto-expand to
 *   reveal it. Leaving that file reverts the auto-expansion — unless the user
 *   had opened those dirs themselves.
 * A user-collapse wins over the CURRENT auto-reveal, but a fresh navigation
 * into that folder re-reveals it (new intent beats old collapse).
 *
 * The USER layer is persisted per project in sessionStorage (same tier as the
 * ResultDeck / atlas-terminal open state in CodeModeView) so it survives
 * Board↔Code Mode flips, rail-tab switches and a reload in the same tab.
 * The AUTO layer is never persisted.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OpenTarget, TreeNode } from './types';
import Tooltip from '../Tooltip';

const TREE_STATE_CAP = 500;

interface PersistedTreeState { open: string[]; closed: string[] }

function treeStorageKey(projectId: string): string {
  return `slycode-code-mode-tree:${projectId}`;
}

function loadTreeState(projectId: string): PersistedTreeState {
  if (typeof window === 'undefined') return { open: [], closed: [] };
  try {
    const raw = sessionStorage.getItem(treeStorageKey(projectId));
    if (!raw) return { open: [], closed: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedTreeState>;
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { open: strs(parsed.open), closed: strs(parsed.closed) };
  } catch {
    return { open: [], closed: [] };
  }
}

function saveTreeState(projectId: string, state: PersistedTreeState): void {
  try {
    if (state.open.length === 0 && state.closed.length === 0) {
      sessionStorage.removeItem(treeStorageKey(projectId));
    } else {
      sessionStorage.setItem(treeStorageKey(projectId), JSON.stringify(state));
    }
  } catch { /* private mode / quota — in-memory state still works */ }
}

function collectDirs(nodes: TreeNode[], out: Set<string>): Set<string> {
  for (const n of nodes) {
    if (n.type === 'dir') {
      out.add(n.path);
      if (n.children) collectDirs(n.children, out);
    }
  }
  return out;
}

function ancestorsOf(filePath: string): string[] {
  const parts = filePath.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

interface FileTreeProps {
  projectId: string;
  tree: TreeNode[] | null;
  error: string | null;
  activePath?: string;
  onOpenFile: (target: OpenTarget) => void;
}

export function FileTree({ projectId, tree, error, activePath, onOpenFile }: FileTreeProps) {
  // Hydrate the durable layer synchronously so the first render already shows
  // the remembered expansion (no collapsed→expanded flash on re-entry).
  const [userOpen, setUserOpen] = useState<Set<string>>(() => new Set(loadTreeState(projectId).open));
  const [userClosed, setUserClosed] = useState<Set<string>>(() => new Set(loadTreeState(projectId).closed));

  // Persist on change. Once the tree is known, prune dirs that no longer
  // exist so stale paths don't accumulate; cap defensively.
  const knownDirs = useMemo(() => (tree ? collectDirs(tree, new Set()) : null), [tree]);
  useEffect(() => {
    const keep = (p: string) => !knownDirs || knownDirs.has(p);
    saveTreeState(projectId, {
      open: [...userOpen].filter(keep).slice(0, TREE_STATE_CAP),
      closed: [...userClosed].filter(keep).slice(0, TREE_STATE_CAP),
    });
  }, [projectId, userOpen, userClosed, knownDirs]);

  // Fresh navigation clears user-collapses along the new target's ancestor
  // chain so the reveal wins (derive-from-props pattern — no effect).
  const [prevActive, setPrevActive] = useState(activePath);
  if (activePath !== prevActive) {
    setPrevActive(activePath);
    if (activePath) {
      const chain = ancestorsOf(activePath);
      setUserClosed(prev => {
        if (!chain.some(a => prev.has(a))) return prev;
        const next = new Set(prev);
        for (const a of chain) next.delete(a);
        return next;
      });
    }
  }

  const auto = new Set(activePath ? ancestorsOf(activePath) : []);
  const isOpen = (dir: string) => !userClosed.has(dir) && (userOpen.has(dir) || auto.has(dir));

  const toggle = (dir: string) => {
    if (isOpen(dir)) {
      setUserOpen(prev => { const n = new Set(prev); n.delete(dir); return n; });
      setUserClosed(prev => new Set(prev).add(dir));
    } else {
      setUserClosed(prev => { const n = new Set(prev); n.delete(dir); return n; });
      setUserOpen(prev => new Set(prev).add(dir));
    }
  };

  // Bring the active file into view after a reveal.
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activePath]);

  if (error) {
    return <p className="p-3 font-mono text-[11px] text-(--cm-stale)">tree failed: {error}</p>;
  }
  if (!tree) {
    return <p className="p-3 font-mono text-[11px] text-(--cm-faint)">loading tree…</p>;
  }
  if (tree.length === 0) {
    return <p className="p-3 font-mono text-[11px] text-(--cm-faint)">empty project</p>;
  }

  return (
    <ul className="px-1.5 py-2 font-mono text-[12px]">
      {tree.map(node => (
        <TreeRow key={node.path} node={node} depth={0} isOpen={isOpen} toggle={toggle} activePath={activePath} activeRef={activeRef} onOpenFile={onOpenFile} />
      ))}
    </ul>
  );
}

function TreeRow({
  node, depth, isOpen, toggle, activePath, activeRef, onOpenFile,
}: {
  node: TreeNode;
  depth: number;
  isOpen: (dir: string) => boolean;
  toggle: (dir: string) => void;
  activePath?: string;
  activeRef: React.MutableRefObject<HTMLButtonElement | null>;
  onOpenFile: (target: OpenTarget) => void;
}) {
  const pad = { paddingLeft: `${depth * 12 + 4}px` };

  if (node.type === 'dir') {
    const open = isOpen(node.path);
    return (
      <li>
        <button
          onClick={() => toggle(node.path)}
          style={pad}
          className="block w-full truncate rounded px-1 py-[1px] text-left leading-[1.9] text-(--cm-text) hover:bg-(--cm-panel3)"
        >
          <span className="text-(--cm-faint)">{open ? '▾ ' : '▸ '}</span>
          {node.name}/
        </button>
        {open && node.children && (
          <ul>
            {node.children.map(child => (
              <TreeRow key={child.path} node={child} depth={depth + 1} isOpen={isOpen} toggle={toggle} activePath={activePath} activeRef={activeRef} onOpenFile={onOpenFile} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const active = node.path === activePath;
  return (
    <li>
      <Tooltip content={node.ignored ? `${node.path} · gitignored (editable)` : node.path} placement="right">
        <button
          ref={active ? (el) => { activeRef.current = el; } : undefined}
          onClick={() => onOpenFile({ path: node.path })}
          style={pad}
          className={`block w-full truncate rounded px-1 py-[1px] text-left leading-[1.9] ${
            active
              ? 'bg-(--cm-atlas-dim) text-(--cm-atlas)'
              : node.ignored
                ? 'text-(--cm-faint) italic hover:bg-(--cm-panel3) hover:text-(--cm-muted)'
                : 'text-(--cm-muted) hover:bg-(--cm-panel3) hover:text-(--cm-text)'
          }`}
        >
          {node.name}
        </button>
      </Tooltip>
    </li>
  );
}
