import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, FileStatus } from "../api";
import CommentRail from "./CommentRail";
import MarkdownPreview from "./MarkdownPreview";
import PanelHeader from "./PanelHeader";
import { useComments } from "./useComments";

type Props = {
  worktreeId: number;
  path: string;
  status: FileStatus;
  /** Active terminal tab: its id and display name. */
  target: { id: number; name: string } | null;
  onOpenFile: (path: string) => void;
};

export default function ReviewPane({ worktreeId, path, status, target, onOpenFile }: Props) {
  const [unanchored, setUnanchored] = useState<Set<number>>(new Set());
  const source = useQuery({ queryKey: ["content", worktreeId, path], queryFn: () => api.content(worktreeId, path), refetchInterval: 3000 });
  const c = useComments(worktreeId, path, target);

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
            comments={c.fileComments}
            onAdd={c.add}
            onUnanchored={setUnanchored}
          />
        )}
        <CommentRail
          comments={c.railComments}
          path={path}
          scope={c.scope}
          onScope={c.setScope}
          unanchored={unanchored}
          target={target?.name ?? null}
          onDelete={c.remove}
          onSend={c.send}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}
