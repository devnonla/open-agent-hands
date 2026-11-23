import { Button, Card, Icon, Input, Tag, message } from "devnonla-ui";
import { useUpdateInfo } from "src/common/hooks/useUpdateInfo";

const INSTALL_NOTE: Record<string, string> = {
  docker: "Run this next to your docker-compose.yml. Data stays in the agenthands-data volume.",
  binary: "Run this on the machine, then restart agenthands.",
};

export function AboutSection() {
  const update = useUpdateInfo();

  const copyCommand = async () => {
    if (!update?.command) return;
    try {
      await navigator.clipboard.writeText(update.command);
      message.success("Command copied");
    } catch {
      message.error("Copy failed");
    }
  };

  const status = (() => {
    if (!update) return null;
    if (update.install === "desktop") return <Tag>Updates from the menu bar</Tag>;
    if (update.updateAvailable && update.latest) return <Tag color="#F2701A" variant="solid">v{update.latest} available</Tag>;
    if (update.latest) return <Tag color="success">Latest</Tag>;
    return null;
  })();

  return (
    <Card title="About">
      <Card.Item label="Version" align="center">
        <span className="inline-flex items-center gap-2">
          <span className="tabular-nums text-muted-foreground">v{__APP_VERSION__}</span>
          {status}
        </span>
      </Card.Item>
      {update?.updateAvailable && update.command ? (
        <Card.Item
          split
          label="Update"
          description={
            <span>
              {INSTALL_NOTE[update.install]}
              {update.releaseUrl ? (
                <>
                  {" "}
                  <a href={update.releaseUrl} target="_blank" rel="noreferrer" className="text-link">
                    What's new
                  </a>
                </>
              ) : null}
            </span>
          }
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <Input value={update.command} readOnly className="font-mono text-xs" />
            <Button type="text" icon={<Icon name="copy" size={14} />} onClick={() => void copyCommand()} aria-label="Copy update command" />
          </div>
        </Card.Item>
      ) : null}
    </Card>
  );
}
