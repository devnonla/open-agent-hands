import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { setCurrentWorkspaceId } from "src/common/workspace";
import { resetWorkspaceState, useAppDispatch } from "src/store/store";

export function useWorkspaceNavigation() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const enterWorkspace = useCallback(
    (id: string, path = "/tools") => {
      setCurrentWorkspaceId(id);
      dispatch(resetWorkspaceState());
      navigate(path);
    },
    [dispatch, navigate],
  );

  return { enterWorkspace };
}
