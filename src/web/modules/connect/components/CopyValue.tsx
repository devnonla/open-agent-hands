import { Button, Icon } from "devnonla-ui";
import { copyText } from "src/modules/my-mcp-servers/common/copy";

export const RESPONSIVE_ROW = "flex-col items-stretch gap-2 @2xl:flex-row @2xl:items-center @2xl:gap-4 [&>div:last-child]:self-stretch [&>div:last-child]:justify-start @2xl:[&>div:last-child]:self-center @2xl:[&>div:last-child]:justify-end";

export function CopyValue({ shown, value, label, toast }: { shown: string; value: string; label: string; toast: string }) {
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1 @2xl:max-w-96">
      <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">{shown}</code>
      <Button type="text" size="small" icon={<Icon name="copy" size={12} />} onClick={() => void copyText(value, toast)} aria-label={label} />
    </span>
  );
}
