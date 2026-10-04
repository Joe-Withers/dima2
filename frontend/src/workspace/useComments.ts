import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, Comment } from "../api";

export type Scope = "file" | "all";

const NONE: Comment[] = []; // stable identity: a fresh [] each render would retrigger the preview's layout effect forever
const SCOPE_KEY = "dima2.commentScope";
const SHOW_SENT_KEY = "dima2.showSentComments";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* remembering the choice is a convenience only */
  }
}

/** The branch's comments, the ones on the open file, and the actions the comment rail needs. */
export function useComments(worktreeId: number, path: string, target: { id: number } | null) {
  const qc = useQueryClient();
  const [scope, setScopeState] = useState<Scope>(stored(SCOPE_KEY) === "all" ? "all" : "file");
  const [showSent, setShowSentState] = useState(stored(SHOW_SENT_KEY) === "true");
  const key = ["comments", worktreeId];
  const query = useQuery({ queryKey: key, queryFn: () => api.comments(worktreeId) });
  const all = query.data ?? NONE;
  const fileComments = useMemo(() => all.filter((c) => c.file_path === path), [all, path]);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const add = useMutation({ mutationFn: (c: { block_id: string; quote: string; body: string }) => api.addComment(worktreeId, { path, ...c }), onSuccess: refresh });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => api.editComment(id, body),
    onSuccess: refresh,
    onError: (e) => alert(e.message),
  });
  const remove = useMutation({ mutationFn: api.deleteComment, onSuccess: refresh });
  const send = useMutation({
    mutationFn: (extra: string) => api.send(worktreeId, { path: scope === "file" ? path : undefined, session_id: target!.id, extra }),
    onSuccess: refresh,
    onError: (e) => alert(e.message),
  });

  function setScope(next: Scope) {
    setScopeState(next);
    remember(SCOPE_KEY, next);
  }

  function setShowSent(next: boolean) {
    setShowSentState(next);
    remember(SHOW_SENT_KEY, String(next));
  }

  return { fileComments, railComments: scope === "all" ? all : fileComments, scope, setScope, showSent, setShowSent, add: add.mutate, edit: (id: number, body: string) => edit.mutate({ id, body }), remove: remove.mutate, send: send.mutate };
}
