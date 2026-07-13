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
 */

import { useEffect, useRef, useState } from 'react';
import type { OpenTarget, TreeNode } from './types';

function ancestorsOf(filePath: string): string[] {
  const parts = filePath.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

interface FileTreeProps {
  tree: TreeNode[] | null;
  error: string | null;
  activePath?: string;
  onOpenFile: (target: OpenTarget) => void;
}

export function FileTree({ tree, error, activePath, onOpenFile }: FileTreeProps) {
  const [userOpen, setUserOpen] = useState<Set<string>>(() => new Set());
  const [userClosed, setUserClosed] = useState<Set<string>>(() => new Set());

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
        title={node.ignored ? `${node.path} · gitignored (editable)` : node.path}
      >
        {node.name}
      </button>
    </li>
  );
}
