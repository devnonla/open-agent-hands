import { message } from "devnonla-ui";
import { useCallback, useState } from "react";
import type { MyMcpServer } from "src/common/types";
import { useAppDispatch } from "src/store/store";
import { toMyMcpServerListItem, updateMyMcpServer, upsertMyMcpServerLocal } from "./myMcpServersSlice";

export function useToggleMcpServer() {
  const dispatch = useAppDispatch();
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  const toggle = useCallback(
    async (server: MyMcpServer, isActive: boolean) => {
      setPending((prev) => new Set(prev).add(server.id));
      dispatch(upsertMyMcpServerLocal({ ...server, isActive }));
      try {
        const updated = (await dispatch(updateMyMcpServer({ id: server.id, isActive })).unwrap()) as MyMcpServer;
        dispatch(upsertMyMcpServerLocal(toMyMcpServerListItem(updated)));
      } catch (err) {
        dispatch(upsertMyMcpServerLocal(server));
        message.error(err instanceof Error ? err.message : String(err));
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(server.id);
          return next;
        });
      }
    },
    [dispatch],
  );

  return { toggle, isPending: (id: string) => pending.has(id) };
}
