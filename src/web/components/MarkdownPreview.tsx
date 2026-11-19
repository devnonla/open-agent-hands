import { MarkdownViewer } from "devnonla-ui/markdown";
import type { ReactNode } from "react";
import { markdownFenceComponents } from "src/components/markdown/fenceBlocks";

interface MarkdownPreviewProps {
  content: string;
  empty?: ReactNode;
  className?: string;
}

export function MarkdownPreview({ content, empty, className }: MarkdownPreviewProps) {
  if (!content.trim()) {
    return empty ?? <p className="m-0 text-sm text-muted-foreground">This file is empty.</p>;
  }

  return <MarkdownViewer value={content} className={className} components={markdownFenceComponents} />;
}
