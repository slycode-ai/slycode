'use client';

import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  confirmClassName?: string;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', confirmClassName = 'bg-red-600 hover:bg-red-700' }: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-(--shadow-overlay) dark:bg-void-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-void-900 dark:text-void-100">{title}</h3>
        </div>
        <div className="mb-6 text-sm text-void-600 dark:text-void-400">
          {message}
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-void-700 hover:bg-void-100 dark:text-void-300 dark:hover:bg-void-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${confirmClassName}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
