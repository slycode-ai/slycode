'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  items?: ContextMenuItem[];
}

export interface ContextMenuGroup {
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  open: boolean;
  position: { x: number; y: number };
  groups: ContextMenuGroup[];
  accentColor?: string;
  onClose: () => void;
}

function CheckIcon() {
  return (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="h-3 w-3 text-void-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

// Convert accent color class (e.g. 'border-t-neon-blue-400', 'border-t-[#ff6a33]') to a CSS color value
function accentColorToCSS(accentColor: string): string {
  const token = accentColor.replace('border-t-', '');
  // Arbitrary hex value like [#ff6a33]
  if (token.startsWith('[') && token.endsWith(']')) {
    return token.slice(1, -1);
  }
  // Map known Tailwind color tokens to CSS custom properties or fallback hex values
  const colorMap: Record<string, string> = {
    'void-400': 'var(--color-void-400, #9ca3af)',
    'neon-blue-400': 'var(--color-neon-blue-400, #60a5fa)',
    'neon-blue-500': 'var(--color-neon-blue-500, #3b82f6)',
    'green-400': 'var(--color-green-400, #4ade80)',
    'orange-400': 'var(--color-orange-400, #fb923c)',
  };
  return colorMap[token] || token;
}

interface SubMenuProps {
  items: ContextMenuItem[];
  parentRect: DOMRect;
  onClose: () => void;
  onAction: () => void;
}

function SubMenu({ items, parentRect, onClose, onAction }: SubMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: parentRect.top, left: parentRect.right + 2 });

  // Viewport-aware positioning
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let left = parentRect.right + 2;
    let top = parentRect.top;

    if (left + rect.width > window.innerWidth - 8) {
      left = parentRect.left - rect.width - 2;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setPosition({ top, left });
  }, [parentRect]);

  const enabledItems = items.map((item, i) => ({ item, index: i })).filter(({ item }) => !item.disabled);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const currentPos = enabledItems.findIndex(({ index }) => index === focusIndex);
        const next = enabledItems[(currentPos + 1) % enabledItems.length];
        if (next) setFocusIndex(next.index);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const currentPos = enabledItems.findIndex(({ index }) => index === focusIndex);
        const prev = enabledItems[(currentPos - 1 + enabledItems.length) % enabledItems.length];
        if (prev) setFocusIndex(prev.index);
        break;
      }
      case 'ArrowLeft':
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Enter': {
        e.preventDefault();
        const focused = items[focusIndex];
        if (focused && !focused.disabled && focused.onClick) {
          focused.onClick();
          onAction();
        }
        break;
      }
    }
  }, [focusIndex, enabledItems, items, onClose, onAction]);

  // Auto-focus
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-context-submenu
      className="context-menu-no-ring fixed z-[52] min-w-[140px] rounded-lg border border-void-200 bg-white py-1 shadow-(--shadow-overlay) dark:border-void-600 dark:bg-void-800"
      style={{ top: position.top, left: position.left }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          role="menuitem"
          onMouseEnter={() => setFocusIndex(i)}
          onMouseLeave={() => setFocusIndex(-1)}
          onClick={() => {
            if (item.disabled) return;
            item.onClick?.();
            onAction();
          }}
          className={`flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-left text-xs outline-none transition-colors ${
            item.disabled
              ? 'text-void-400 dark:text-void-500'
              : item.danger
                ? 'cursor-pointer text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                : 'cursor-pointer text-void-700 hover:bg-void-100 dark:text-void-300 dark:hover:bg-void-700'
          } ${focusIndex === i && !item.disabled ? 'bg-void-100 dark:bg-void-700' : ''}`}
        >
          <span className="w-3.5 shrink-0">
            {item.checked && <CheckIcon />}
          </span>
          <span className="flex-1">{item.label}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}

export function ContextMenu({ open, position, groups, accentColor, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState(position);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Flatten groups into a list with separator indices
  const flatItems: ({ type: 'item'; item: ContextMenuItem; groupIndex: number; itemIndex: number } | { type: 'separator' })[] = [];
  groups.forEach((group, gi) => {
    if (gi > 0 && group.items.length > 0) {
      flatItems.push({ type: 'separator' });
    }
    group.items.forEach((item, ii) => {
      flatItems.push({ type: 'item', item, groupIndex: gi, itemIndex: ii });
    });
  });

  // Map from flat index to actual item entries only
  const itemEntries = flatItems
    .map((entry, i) => ({ entry, flatIndex: i }))
    .filter((e): e is { entry: { type: 'item'; item: ContextMenuItem; groupIndex: number; itemIndex: number }; flatIndex: number } => e.entry.type === 'item');

  const enabledEntries = itemEntries.filter(({ entry }) => !entry.item.disabled || entry.item.items);

  // Viewport-aware main menu positioning
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let x = position.x;
    let y = position.y;

    if (x + rect.width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setMenuPos({ x, y });
  }, [open, position]);

  // Reset state when menu opens/closes
  useEffect(() => {
    if (open) {
      setFocusIndex(-1);
      setOpenSubmenuIndex(null);
      requestAnimationFrame(() => {
        menuRef.current?.focus();
        if (enabledEntries.length > 0) {
          setFocusIndex(enabledEntries[0].flatIndex);
        }
      });
    }
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Click-outside dismiss — check both main menu and any submenu portals
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check if click is inside main menu
      if (menuRef.current?.contains(target)) return;
      // Check if click is inside any submenu (portalled to body, z-[52])
      const submenus = document.querySelectorAll('[data-context-submenu]');
      for (const sub of submenus) {
        if (sub.contains(target)) return;
      }
      onClose();
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, onClose]);

  const handleAction = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (openSubmenuIndex !== null) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        e.stopPropagation();
        const currentPos = enabledEntries.findIndex(({ flatIndex: fi }) => fi === focusIndex);
        const next = enabledEntries[(currentPos + 1) % enabledEntries.length];
        if (next) setFocusIndex(next.flatIndex);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        const currentPos = enabledEntries.findIndex(({ flatIndex: fi }) => fi === focusIndex);
        const prev = enabledEntries[(currentPos - 1 + enabledEntries.length) % enabledEntries.length];
        if (prev) setFocusIndex(prev.flatIndex);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        e.stopPropagation();
        const focused = flatItems[focusIndex];
        if (focused?.type === 'item' && focused.item.items) {
          setOpenSubmenuIndex(focusIndex);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case 'Enter': {
        e.preventDefault();
        e.stopPropagation();
        const focused = flatItems[focusIndex];
        if (focused?.type === 'item') {
          if (focused.item.items) {
            setOpenSubmenuIndex(focusIndex);
          } else if (!focused.item.disabled && focused.item.onClick) {
            focused.item.onClick();
            handleAction();
          }
        }
        break;
      }
    }
  }, [focusIndex, enabledEntries, flatItems, openSubmenuIndex, onClose, handleAction]);

  const handleItemMouseEnter = useCallback((fi: number) => {
    setFocusIndex(fi);
    const entry = flatItems[fi];
    if (entry?.type === 'item' && entry.item.items) {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = setTimeout(() => {
        setOpenSubmenuIndex(fi);
      }, 150);
    } else {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      setOpenSubmenuIndex(null);
    }
  }, [flatItems]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      tabIndex={-1}
      role="menu"
      onKeyDown={handleKeyDown}
      className="context-menu-no-ring fixed z-[51] min-w-[180px] overflow-hidden rounded-lg border border-void-200 bg-white shadow-(--shadow-overlay) dark:border-void-600 dark:bg-void-800"
      style={{ top: menuPos.y, left: menuPos.x }}
    >
      {/* Accent color bar */}
      {accentColor && (
        <div
          className="h-0.5 w-full"
          style={{ backgroundColor: accentColorToCSS(accentColor) }}
        />
      )}

      <div className="py-1">
        {flatItems.map((entry, fi) => {
          if (entry.type === 'separator') {
            return <div key={`sep-${fi}`} className="my-1 border-t border-void-200 dark:border-void-700" />;
          }

          const { item } = entry;
          const hasSubmenu = !!item.items;
          const isDisabledLeaf = item.disabled && !hasSubmenu;

          return (
            <div
              key={fi}
              ref={(el) => { if (el) itemRefs.current.set(fi, el); }}
              role="menuitem"
              onMouseEnter={() => handleItemMouseEnter(fi)}
              onClick={() => {
                if (hasSubmenu) {
                  setOpenSubmenuIndex(fi);
                  return;
                }
                if (isDisabledLeaf) return;
                item.onClick?.();
                handleAction();
              }}
              className={`flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-left text-xs outline-none transition-colors select-none ${
                isDisabledLeaf
                  ? 'text-void-400 dark:text-void-500'
                  : item.danger
                    ? 'cursor-pointer text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                    : 'cursor-pointer text-void-700 hover:bg-void-100 dark:text-void-300 dark:hover:bg-void-700'
              } ${focusIndex === fi && !isDisabledLeaf ? 'bg-void-100 dark:bg-void-700' : ''}`}
            >
              <span className="w-3.5 shrink-0">
                {item.checked && <CheckIcon />}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {hasSubmenu && <ChevronIcon />}
            </div>
          );
        })}
      </div>

      {/* Render submenus as siblings, not children of menu items */}
      {flatItems.map((entry, fi) => {
        if (entry.type !== 'item' || !entry.item.items || openSubmenuIndex !== fi) return null;
        const itemEl = itemRefs.current.get(fi);
        if (!itemEl) return null;

        return (
          <SubMenu
            key={`sub-${fi}`}
            items={entry.item.items}
            parentRect={itemEl.getBoundingClientRect()}
            onClose={() => {
              setOpenSubmenuIndex(null);
              menuRef.current?.focus();
            }}
            onAction={handleAction}
          />
        );
      })}
    </div>,
    document.body
  );
}
