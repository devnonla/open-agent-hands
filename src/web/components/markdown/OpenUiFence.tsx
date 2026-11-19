import { Renderer } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import type { MarkdownFenceProps } from "devnonla-ui/markdown";
import { useState } from "react";
import { repairOpenUiSource } from "src/components/markdown/repairOpenUiSource";

export function OpenUiFence({ code }: MarkdownFenceProps) {
  const source = repairOpenUiSource(code.trim());
  const [error, setError] = useState<string | null>(null);
  if (!source) return null;

  return (
    <div className="openui-fence my-3 overflow-x-auto overflow-y-hidden rounded-xl border border-border bg-card px-3 py-3">
      {error ? <p className="m-0 mb-2 text-xs text-destructive">{error}</p> : null}
      <Renderer
        response={source}
        library={openuiLibrary}
        onError={(errors) => {
          const next = errors.find((item) => item.severity !== "warning")?.message ?? null;
          setError((prev) => (prev === next ? prev : next));
        }}
      />
    </div>
  );
}
