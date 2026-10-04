import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, Comment } from "../api";

export type Scope = "file" | "all";

const NONE: Comment[] = []; // stable identity: a fresh [] each render would retrigger the preview's layout effect forever
const STORAGE = "dima2.commentScope";

function storedScope(): Scope {
  try {
    return localStorage.getItem(STORAGE) === "all" ? "all" : "file";
  } catch {
    return "file";
  }
}

/** The branch's comments, the ones on the open file, and the actions the comment rail needs. */
export function useComments(worktreeId: number, path: string, target: { id: number } | null) {
  const qc = useQueryClient();
  const [scope, setScopeState] = useState<Scope>(storedScope);
  const key = ["comments", worktreeId];
  const query = useQuery({ queryKey: key, queryFn: () => api.comments(worktreeId) });
  const all = query.data ?? NONE;
  const fileComments = useMemo(() => all.filter((c) => c.file_path === path), [all, path]);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const add = useMutation({ mutationFn: (c: { block_id: string; quote: string; body: string }) => api.addComment(worktreeId, { path, ...c }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteComment, onSuccess: refresh });
  const send = useMutation({
    mutationFn: (extra: string) => api.send(worktreeId, { path: scope === "file" ? path : undefined, session_id: target!.id, extra }),
    onSuccess: refresh,
    onError: (e) => alert(e.message),
  });

  function setScope(next: Scope) {
    setScopeState(next);
    try {
      localStorage.setItem(STORAGE, next);
    } catch {
      /* remembering the choice is a convenience only */
    }
  }

  return { fileComments, railComments: scope === "all" ? all : fileComments, scope, setScope, add: add.mutate, remove: remove.mutate, send: send.mutate };
}
