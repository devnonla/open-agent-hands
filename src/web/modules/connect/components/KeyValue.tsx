import { Button, Icon, Modal, Tooltip, message } from "devnonla-ui";
import { apiClient } from "src/common/api";
import { maskKey } from "../common/snippets";
import { CopyValue } from "./CopyValue";

export function KeyValue({ apiKey, onRotated }: { apiKey: string; onRotated: (key: string) => void }) {
  const rotate = () => {
    Modal.confirm({
      title: "Rotate the key?",
      content: "Every agent using the current key, over the CLI or MCP, stops working until it gets the new one.",
      okText: "Rotate",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        try {
          const next = await apiClient.post<{ key: string }>("/api/core-mcp/rotate");
          onRotated(next.key);
          message.success("Key rotated");
        } catch (err) {
          message.error(err instanceof Error ? err.message : "Failed to rotate the key");
        }
      },
    });
  };

  return (
    <span className="flex min-w-0 items-center gap-2">
      <CopyValue shown={maskKey(apiKey)} value={apiKey} label="Copy key" toast="Key copied" />
      <Tooltip title="Get a new key">
        <Button size="small" icon={<Icon name="refresh" size={12} />} onClick={rotate}>
          Rotate
        </Button>
      </Tooltip>
    </span>
  );
}
