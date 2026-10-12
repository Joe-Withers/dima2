import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "./api";

/** Archive after a confirm; a worktree with uncommitted or untracked files asks again before forcing it. */
export function useArchive(onArchived: () => void) {
  const mutation = useMutation({
    mutationFn: ({ id, force }: { id: number; branch: string; force: boolean }) => api.archiveWorktree(id, force),
    onSuccess: onArchived,
    onError: (e, { id, branch, force }) => {
      if (!force && e instanceof ApiError && e.status === 409) {
        const lose = `${e.message}. Archive anyway? Uncommitted changes and untracked files will be lost; commits stay on ${branch}.`;
        if (confirm(lose)) mutation.mutate({ id, branch, force: true });
      } else alert(e.message);
    },
  });
  return (id: number, branch: string) =>
    confirm(`Archive ${branch}? This removes its folder.`) && mutation.mutate({ id, branch, force: false });
}
