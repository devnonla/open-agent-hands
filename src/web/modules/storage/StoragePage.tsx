import { Card, Empty, Skeleton } from "devnonla-ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fetchStorageSpaces } from "./common/storageSlice";
import { SpaceCard } from "./components/SpaceCard";


export default function StoragePage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const spaces = useAppSelector((s) => s.storage.spaces);
  const loaded = useAppSelector((s) => s.storage.spacesLoaded);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchStorageSpaces())
      .unwrap()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [dispatch]);

  return (
    <PageShell header={<PageHeader title="Storage" icon="storage" description="Files your agents keep, grouped by space." className="mb-0 pb-0" bordered={false} />}>
      {!loaded && !error ? (
        <div className="@container">
          <div className="flex flex-col gap-3">
            {["a", "b", "c"].map((key) => (
              <Card key={key}>
                <div className="px-5 py-4">
                  <Skeleton paragraph={{ rows: 2 }} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {error && !loaded ? <Empty className="py-16" description={error} /> : null}

      {loaded && spaces.length === 0 ? (
        <Empty className="py-16" description="No spaces yet">
          <AskClaudeHint what="storage space" tool="storage_create_space" />
        </Empty>
      ) : null}

      {spaces.length > 0 ? (
        <div className="@container">
          <div className="flex flex-col gap-3">
            {spaces.map((space) => (
              <SpaceCard key={space.id} space={space} onOpen={() => navigate(`/storage/${encodeURIComponent(space.name)}`)} />
            ))}
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
