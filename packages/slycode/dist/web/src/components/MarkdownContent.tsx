'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  children: string;
}

export function MarkdownContent({ children }: MarkdownContentProps) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-void-900 dark:prose-headings:text-void-100 prose-code:rounded prose-code:bg-void-100 prose-code:px-1 prose-code:py-0.5 dark:prose-code:bg-void-800 prose-pre:bg-void-100 dark:prose-pre:bg-void-800 prose-table:border-collapse prose-th:border prose-th:border-void-300 prose-th:bg-void-100 prose-th:px-3 prose-th:py-1.5 dark:prose-th:border-void-700 dark:prose-th:bg-void-800 prose-td:border prose-td:border-void-300 prose-td:px-3 prose-td:py-1.5 dark:prose-td:border-void-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
