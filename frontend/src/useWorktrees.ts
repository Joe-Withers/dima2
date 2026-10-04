import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const useWorktrees = () => useQuery({ queryKey: ["worktrees"], queryFn: api.worktrees, refetchInterval: 5000 });

/** Active worktrees that need the user: an agent is waiting on a prompt, or finished and hasn't been looked at. */
export function useAttentionCount() {
  const { data } = useWorktrees();
  return (data ?? []).filter((w) => !w.archived_at && (w.status === "needs_input" || w.done)).length;
}
