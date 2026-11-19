import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { fetchAgents } from "src/modules/agents/common/agentsSlice";
import { fetchTeams } from "src/modules/agents/common/teamsSlice";
import { useAppDispatch } from "src/store/store";

export default function AgentsLayout() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    void Promise.all([dispatch(fetchAgents()), dispatch(fetchTeams())]);
  }, [dispatch]);

  return (
    <div className="h-full w-full overflow-hidden">
      <Outlet />
    </div>
  );
}
