import { useState } from "react";
import { Comment } from "../api";
import { Close, Send } from "./icons";
import { Scope } from "./useComments";

type Props = {
  /** What the rail lists: the open file's comments, or the whole branch's. */
  comments: Comment[];
  /** The open file. */
  path: string;
  scope: Scope;
  onScope: (scope: Scope) => void;
  /** Ids of comments on the open file whose anchor is gone. */
  unanchored: Set<number>;
  /** The active terminal tab, e.g. "session 2"; null when there is none. */
  target: string | null;
  onDelete: (id: number) => void;
  onSend: (extra: string) => void;
  onOpenFile: (path: string) => void;
};

const time = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Card({ c, n, unanchored, onDelete }: { c: Comment; n: number; unanchored: boolean; onDelete: (id: number) => void }) {
  const sent = !!c.sent_at;
  return (
    <div className={`card-c${sent ? " sent" : ""}`}>
      <div className="card-head">
        <span className={`mk static${sent ? " sent" : ""}`}>{n}</span>
        <span className="quote">{c.quote}</span>
        {!sent && <button className="iconbtn small" aria-label={`Delete comment ${n}`} onClick={() => onDelete(c.id)}><Close /></button>}
      </div>
      <p>{c.body}</p>
      <span className={sent ? "faint small" : "accent small"}>
        {sent ? `Sent to ${c.sent_to} · ${time(c.sent_at!)}` : "Not sent"}
        {unanchored && " · block not found"}
      </span>
    </div>
  );
}

export default function CommentRail({ comments, path, scope, onScope, unanchored, target, onDelete, onSend, onOpenFile }: Props) {
  const [extra, setExtra] = useState("");
  const unsent = comments.filter((c) => !c.sent_at).length;
  const canSend = target !== null && (unsent > 0 || extra.trim() !== "");
  // Numbers restart per file, matching the markers shown in that file.
  const seen = new Map<string, number>();
  const numbered = comments.map((c) => {
    const n = (seen.get(c.file_path) ?? 0) + 1;
    seen.set(c.file_path, n);
    return { c, n };
  });
  const files = [...new Set(comments.map((c) => c.file_path))].sort((a, b) => Number(b === path) - Number(a === path) || a.localeCompare(b));
  const inFile = (file: string) => numbered.filter(({ c }) => c.file_path === file);

  return (
    <aside className="rail" aria-label="Comments">
      <div className="rail-list">
        <div className="rail-title">
          <span className="cap">Comments</span>
          <span className="faint small">{unsent} unsent · {comments.length - unsent} sent</span>
        </div>
        <div className="seg" role="group" aria-label="Comment scope">
          <button className={scope === "file" ? "on" : ""} aria-pressed={scope === "file"} onClick={() => onScope("file")}>This file</button>
          <button className={scope === "all" ? "on" : ""} aria-pressed={scope === "all"} onClick={() => onScope("all")}>All files</button>
        </div>
        {comments.length === 0 && <p className="faint small">{scope === "all" ? "No comments on this branch yet." : "Select text to add a comment."}</p>}
        {scope === "file" ? (
          <>
            {inFile(path).filter(({ c }) => !unanchored.has(c.id)).map(({ c, n }) => <Card key={c.id} c={c} n={n} unanchored={false} onDelete={onDelete} />)}
            {inFile(path).some(({ c }) => unanchored.has(c.id)) && <span className="cap">Block not found</span>}
            {inFile(path).filter(({ c }) => unanchored.has(c.id)).map(({ c, n }) => <Card key={c.id} c={c} n={n} unanchored onDelete={onDelete} />)}
          </>
        ) : (
          files.map((file) => (
            <div key={file} className="rail-file">
              <button className={`rail-path mono${file === path ? " here" : ""}`} title={file} onClick={() => onOpenFile(file)}>{file}</button>
              {inFile(file).map(({ c, n }) => <Card key={c.id} c={c} n={n} unanchored={file === path && unanchored.has(c.id)} onDelete={onDelete} />)}
            </div>
          ))
        )}
      </div>
      <div className="rail-send">
        <label htmlFor="extra" className="lbl">Additional context</label>
        <textarea id="extra" className="ta" rows={2} placeholder="Anything not tied to a passage" value={extra} onChange={(e) => setExtra(e.target.value)} />
        <button className="btn primary wide" disabled={!canSend} onClick={() => (onSend(extra), setExtra(""))}>
          <Send />
          {target ? `Send ${unsent} comment${unsent === 1 ? "" : "s"} to ${target}` : "Start a session to send"}
        </button>
      </div>
    </aside>
  );
}
