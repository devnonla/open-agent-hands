import { Popover } from "devnonla-ui";
import { Info } from "lucide-react";

function KeyHelp() {
  return (
    <div className="flex max-w-80 flex-col gap-2 text-sm">
      <p className="m-0">oahctl and MCP clients use this same key.</p>
      <p className="m-0">Rotating it logs every agent out, on both tabs, until they get the new key.</p>
    </div>
  );
}

export function KeyLabel() {
  return (
    <>
      Key
      <Popover trigger="hover" placement="bottomLeft" mouseEnterDelay={0.15} content={<KeyHelp />}>
        <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground">
          <Info size={14} />
        </span>
      </Popover>
    </>
  );
}
