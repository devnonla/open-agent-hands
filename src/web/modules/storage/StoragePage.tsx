import { Card, Empty, Skeleton } from "devnonla-ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConnectAgentEmpty } from "src/components/ConnectAgentEmpty";
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
          <div className="grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2">
            {["a", "b", "c"].map((key) => (
              <Card key={key}>
                <div className="flex min-h-44 flex-col gap-4 p-5">
                  <Skeleton.Input className="size-7" />
                  <Skeleton paragraph={{ rows: 3 }} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {error && !loaded ? <Empty className="py-16" description={error} /> : null}

      {loaded && spaces.length === 0 ? (
        <ConnectAgentEmpty title="No spaces yet" what="storage space" tool="storage_create_space" />
      ) : null}

      {spaces.length > 0 ? (
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2">
            {spaces.map((space) => (
              <SpaceCard key={space.id} space={space} onOpen={() => navigate(`/storage/${encodeURIComponent(space.name)}`)} />
            ))}
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
