import { Alert, Button, Icon, Input, Modal, message } from "devnonla-ui";
import type { ApiKey } from "src/common/types";

interface CreatedKeyDialogProps {
  created: ApiKey;
  onClose: () => void;
}

export function CreatedKeyDialog({ created, onClose }: CreatedKeyDialogProps) {
  const secret = created.key?.trim() ?? "";

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      message.success("Key copied");
    } catch {
      message.error("Copy failed");
    }
  };

  return (
    <Modal
      open
      title="API key created"
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          Done
        </Button>
      }
      destroyOnHidden
      width={560}
    >
      <div className="flex flex-col gap-4 pt-1">
        <Alert type="warning" showIcon title="Copy this key now. You will not be able to see it again." />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Secret key</span>
          <div className="flex items-center gap-2">
            <Input value={secret} readOnly className="font-mono text-[12px]" />
            <Button type="text" icon={<Icon name="copy" size={14} />} onClick={() => void copyKey()} aria-label="Copy key" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
