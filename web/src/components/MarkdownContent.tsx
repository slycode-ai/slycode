'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  children: string;
}

export function MarkdownContent({ children }: MarkdownContentProps) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-ink-1 prose-code:rounded prose-code:bg-surface-3 prose-code:px-1 prose-code:py-0.5 prose-pre:bg-surface-3 prose-pre:text-void-800 dark:prose-pre:text-[var(--tw-prose-invert-pre-code)] prose-table:border-collapse prose-th:border prose-th:border-line-strong prose-th:bg-surface-2 prose-th:px-3 prose-th:py-1.5 prose-td:border prose-td:border-line-strong prose-td:px-3 prose-td:py-1.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
