import { Alert, Button, ButtonCopy, Card, CodeBlock, Empty, Icon, PageHeader, Popconfirm, Spin, Tag, message } from "devnonla-ui";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "src/common/api";
import { usePublicUrl } from "src/common/hooks/usePublicUrl";
import type { ApiKeyDetail, DatatableProject, KvProject, KvStoreEntry } from "src/common/types";
import { formatDateTime, relativeTime } from "src/common/utils/date";
import { ContentBreadcrumb, ContentHeader } from "src/components/ContentBreadcrumb";
import { FeatureIcon } from "src/components/FeatureIcon";
import { PageBand, PageScroll, PAGE_GUTTER } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { WindowHeaderBackButton } from "src/components/WindowHeaderBackButton";
import { copyText } from "src/modules/my-mcp-servers/common/copy";
import { apiKeyPrompt, hasApiKeyAccess, scopeNames } from "../../common/apiKeyPrompt";
import { ApiKeyFormDialog } from "../ApiKeyFormDialog";

const LIST_PATH = "/connect/api";

type PickerData = { datatableProjects: DatatableProject[]; kvEntries: KvStoreEntry[]; kvProjectNames: Record<string, string> };

function useOneTimeSecret(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [secret] = useState<string | null>(() => (location.state as { secret?: string } | null)?.secret ?? null);

  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  return secret;
}

function AccessCard({ title, all, allLabel, count, children }: { title: string; all: boolean; allLabel: string; count: number; children: React.ReactNode }) {
  return <Card title={all ? title : `${title} (${count})`}>{all ? <Card.Item label={allLabel} description="Including ones created later." /> : count === 0 ? <Card.Item description="No access." /> : children}</Card>;
}

function KeyDetail({ apiKey, secret, onChanged }: { apiKey: ApiKeyDetail; secret: string | null; onChanged: () => void }) {
  const navigate = useNavigate();
  const publicUrl = usePublicUrl();
  const [picker, setPicker] = useState<PickerData | null>(null);
  const [opening, setOpening] = useState(false);
  const base = `${publicUrl?.effective || window.location.origin}/api/v1`;
  const usable = hasApiKeyAccess(apiKey);
  const prompt = apiKeyPrompt(base, apiKey, scopeNames(apiKey), secret ?? undefined);

  const openEdit = async () => {
    setOpening(true);
    try {
      const [projects, kv, kvProjects] = await Promise.all([apiClient.get<DatatableProject[]>("/api/datatables/projects"), apiClient.get<{ items: KvStoreEntry[] }>("/api/kvstore", { sorts: "key" }), apiClient.get<{ items: KvProject[] }>("/api/kvstore/projects")]);
      setPicker({ datatableProjects: projects, kvEntries: kv.items, kvProjectNames: Object.fromEntries(kvProjects.items.map((p) => [p.id, p.name === "default" ? "Default" : p.name])) });
    } catch {
      message.error("Failed to load datatables and KV keys");
    } finally {
      setOpening(false);
    }
  };

  const handleDelete = async () => {
    try {
      await apiClient.delete(`/api/api-keys/${apiKey.id}`);
      message.success(`Deleted ${apiKey.name}`);
      navigate(LIST_PATH);
    } catch {
      message.error("Failed to delete");
    }
  };

  return (
    <>
      <PageBand
        width="max-w-3xl"
        header={
          <PageHeader
            bordered={false}
            className="mb-0 pb-0"
            title={
              <span className="flex min-w-0 items-center gap-3 text-xl">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Icon name="shield-check" size={20} />
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{apiKey.name}</span>
              </span>
            }
            description={<code className="block pl-13 font-mono text-xs">{apiKey.keyPrefix}…</code>}
            extra={
              <Button icon={<Icon name="pen" size={14} />} loading={opening} onClick={() => void openEdit()}>
                Edit access
              </Button>
            }
          />
        }
      />
      <PageScroll>
        <div className={`@container mx-auto flex w-full max-w-3xl flex-col gap-6 pt-6 pb-12 ${PAGE_GUTTER}`}>
          <RenderIf condition={!!secret}>
            <Card title="Secret key" caption="Shown only now. Copy it before you leave this page.">
              <Card.Item label={<code className="font-mono text-xs break-all">{secret}</code>} align="center">
                <ButtonCopy text={secret ?? ""} label="Copy key" />
              </Card.Item>
            </Card>
          </RenderIf>

          <Card title="Prompt" caption={secret ? "Includes the key, so copy it before you leave." : "The key is shown only once, so the agent asks you for it."}>
            {usable ? (
              <>
                <Card.Item label="Setup prompt" description="Paste into your agent. It covers only what this key can reach." align="center">
                  <Button size="small" type="primary" icon={<Icon name="copy" size={13} />} onClick={() => void copyText(prompt, "Prompt copied. Paste it into your agent.")}>
                    Copy prompt
                  </Button>
                </Card.Item>
                <div className="px-4 pb-4">
                  <CodeBlock code={prompt} language="plaintext" title="Prompt" wordWrap className="max-h-96 overflow-auto" />
                </div>
              </>
            ) : (
              <div className="p-4">
                <Alert type="warning" showIcon title="This key can't reach anything yet. Edit its access first." />
              </div>
            )}
          </Card>

          <AccessCard title="Datatables" all={apiKey.datatablesUnrestricted} allLabel="Every project" count={apiKey.datatableProjects.length}>
            {apiKey.datatableProjects.map((project) => (
              <Card.Item key={project.id} label={project.name} align="center">
                <Link to={`/datatables/${project.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                  Open
                </Link>
              </Card.Item>
            ))}
          </AccessCard>

          <AccessCard title="KV" all={apiKey.kvUnrestricted} allLabel="Every key, and it can create new ones" count={apiKey.kvEntries.length}>
            {apiKey.kvEntries.map((entry) => (
              <Card.Item key={entry.id} label={<code className="font-mono text-xs">{entry.key}</code>} align="center">
                {entry.projectName === "default" ? null : <Tag>{entry.projectName}</Tag>}
              </Card.Item>
            ))}
          </AccessCard>

          <Card title="Activity">
            <Card.Item label="Last used" align="center">
              <span className="text-muted-foreground">{apiKey.lastUsedAt ? relativeTime(apiKey.lastUsedAt) : "Never"}</span>
            </Card.Item>
            <Card.Item label="Created" align="center">
              <span className="tabular-nums text-muted-foreground">{formatDateTime(apiKey.createdAt)}</span>
            </Card.Item>
          </Card>

          <Card title="Danger zone">
            <Card.Item label="Delete key" description="Scripts and agents using this key stop working at once." align="center">
              <Popconfirm title={`Delete ${apiKey.name}?`} description="This cannot be undone." okText="Delete" okType="danger" onConfirm={() => void handleDelete()}>
                <Button danger icon={<Icon name="trash" size={14} />}>
                  Delete key
                </Button>
              </Popconfirm>
            </Card.Item>
          </Card>
        </div>
      </PageScroll>

      <RenderIf condition={!!picker}>
        <ApiKeyFormDialog
          edit={apiKey}
          datatableProjects={picker?.datatableProjects ?? []}
          kvEntries={picker?.kvEntries ?? []}
          kvProjectNames={picker?.kvProjectNames}
          onClose={() => setPicker(null)}
          onCreated={() => setPicker(null)}
          onUpdated={() => {
            setPicker(null);
            message.success("Updated");
            onChanged();
          }}
        />
      </RenderIf>
    </>
  );
}

export default function ApiKeyPage() {
  const { id = "" } = useParams<{ id: string }>();
  const secret = useOneTimeSecret();
  const [apiKey, setApiKey] = useState<ApiKeyDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  const load = useCallback(async () => {
    try {
      setApiKey(await apiClient.get<ApiKeyDetail>(`/api/api-keys/${id}`));
      setStatus("ready");
    } catch {
      setStatus("missing");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ContentHeader
        left={
          <div className="flex min-w-0 items-center gap-2">
            <WindowHeaderBackButton to={LIST_PATH} label="Back to API keys" />
            <ContentBreadcrumb items={[{ label: "API keys", to: LIST_PATH, icon: <FeatureIcon name="connect" size={16} variant="sticker" /> }, { label: apiKey?.name ?? "API key" }]} />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">{status === "loading" ? <Spin className="flex justify-center py-16" /> : apiKey && status === "ready" ? <KeyDetail apiKey={apiKey} secret={secret} onChanged={() => void load()} /> : <Empty className="py-16" description="This API key no longer exists." />}</div>
    </div>
  );
}
