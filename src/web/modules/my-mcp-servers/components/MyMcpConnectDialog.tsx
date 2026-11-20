import { Modal } from "devnonla-ui";
import type { MyMcpServer } from "src/common/types";
import { McpConnectPanel } from "./McpConnectPanel";

export function MyMcpConnectDialog({ server, onClose, onRotated }: { server: MyMcpServer | null; onClose: () => void; onRotated: (server: MyMcpServer) => void }) {
  return (
    <Modal open={!!server} onCancel={onClose} title={server ? `Connect "${server.name}"` : "Connect"} footer={null} destroyOnHidden width={640} centered>
      {server ? <McpConnectPanel server={server} onRotated={onRotated} /> : null}
    </Modal>
  );
}
