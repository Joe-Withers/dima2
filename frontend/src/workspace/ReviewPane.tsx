import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, FileStatus } from "../api";
import CommentRail from "./CommentRail";
import MarkdownPreview from "./MarkdownPreview";
import PanelHeader from "./PanelHeader";

type Props = {
  worktreeId: number;
  path: string;
  status: FileStatus;
  /** Active terminal tab: its id and display name. */
  target: { id: number; name: string } | null;
};

export default function ReviewPane({ worktreeId, path, status, target }: Props) {
  const qc = useQueryClient();
  const [unanchored, setUnanchored] = useState<Set<number>>(new Set());
  const source = useQuery({ queryKey: ["content", worktreeId, path], queryFn: () => api.content(worktreeId, path), refetchInterval: 3000 });
  const commentsKey = ["comments", worktreeId, path];
  const comments = useQuery({ queryKey: commentsKey, queryFn: () => api.comments(worktreeId, path) });
  const refresh = () => qc.invalidateQueries({ queryKey: commentsKey });

  const add = useMutation({ mutationFn: (c: { block_id: string; quote: string; body: string }) => api.addComment(worktreeId, { path, ...c }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteComment, onSuccess: refresh });
  const send = useMutation({
    mutationFn: (extra: string) => api.send(worktreeId, { path, session_id: target!.id, extra }),
    onSuccess: refresh,
    onError: (e) => alert(e.message),
  });

  return (
    <div className="center">
      <PanelHeader path={path} status={status}>
        <span className="chip">Preview</span>
      </PanelHeader>
      <div className="review">
        {source.data !== undefined && (
          <MarkdownPreview
            worktreeId={worktreeId}
            path={path}
            source={source.data}
            comments={comments.data ?? []}
            onAdd={add.mutate}
            onUnanchored={setUnanchored}
          />
        )}
        <CommentRail
          comments={comments.data ?? []}
          unanchored={unanchored}
          target={target?.name ?? null}
          onDelete={remove.mutate}
          onSend={send.mutate}
        />
      </div>
    </div>
  );
}
