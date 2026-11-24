import { Card, Skeleton, Tag } from "devnonla-ui";
import { ConnectAgentPanel } from "src/components/ConnectAgentPanel";
import { CLI_INSTALL_COMMAND, cliLoginCommand, maskKey } from "../common/snippets";
import type { ConnectInfo } from "../common/useConnectInfo";
import { CopyValue, RESPONSIVE_ROW } from "./CopyValue";
import { KeyLabel } from "./KeyLabel";
import { KeyValue } from "./KeyValue";
import { TerminalDemo } from "./TerminalDemo";

export function CliTab({ info }: { info: ConnectInfo }) {
  const { server, key: apiKey, error, setKey } = info;
  const pending = error ? <span className="text-xs text-destructive">{error}</span> : <Skeleton.Input active />;
  const masked = apiKey ? maskKey(apiKey) : "ah_core_…";

  return (
    <>
      <ConnectAgentPanel
        showDetails={false}
        title={
          <span className="inline-flex flex-wrap items-center justify-center gap-2">
            Connect with the command line
            <Tag color="brand">Recommended</Tag>
          </span>
        }
        description="Works in any agent that runs shell commands, with nothing to configure. Paste the prompt and the agent installs oahctl and logs in."
      />

      <TerminalDemo server={server} maskedKey={masked} />

      <Card title="Command line">
        <Card.Item label="Server" description="Address oahctl connects to." align="center" className={RESPONSIVE_ROW}>
          <CopyValue shown={server} value={server} label="Copy server address" toast="Address copied" />
        </Card.Item>
        <Card.Item label={<KeyLabel />} description="Treat it like a password." align="center" className={RESPONSIVE_ROW}>
          {apiKey ? <KeyValue apiKey={apiKey} onRotated={setKey} /> : pending}
        </Card.Item>
        <Card.Item label="Log in" description="Saves this server in oahctl." align="center" className={RESPONSIVE_ROW}>
          {apiKey ? <CopyValue shown={cliLoginCommand(server, masked)} value={cliLoginCommand(server, apiKey)} label="Copy login command" toast="Login command copied" /> : pending}
        </Card.Item>
        <Card.Item label="Install" description="oahctl runs on Node 18+ or Bun." align="center" className={RESPONSIVE_ROW}>
          <CopyValue shown={CLI_INSTALL_COMMAND} value={CLI_INSTALL_COMMAND} label="Copy install command" toast="Install command copied" />
        </Card.Item>
      </Card>
    </>
  );
}
