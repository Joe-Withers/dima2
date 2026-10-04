import { useState } from "react";
import { Comment } from "../api";
import { Close, Send } from "./icons";

type Props = {
  comments: Comment[];
  unanchored: Set<number>;
  /** The active terminal tab, e.g. "session 2"; null when there is none. */
  target: string | null;
  onDelete: (id: number) => void;
  onSend: (extra: string) => void;
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

export default function CommentRail({ comments, unanchored, target, onDelete, onSend }: Props) {
  const [extra, setExtra] = useState("");
  const numbered = comments.map((c, i) => ({ c, n: i + 1 }));
  const unsent = comments.filter((c) => !c.sent_at).length;
  const canSend = target !== null && (unsent > 0 || extra.trim() !== "");
  const anchored = numbered.filter(({ c }) => !unanchored.has(c.id));
  const lost = numbered.filter(({ c }) => unanchored.has(c.id));

  return (
    <aside className="rail" aria-label="Comments">
      <div className="rail-list">
        <div className="rail-title">
          <span className="cap">Comments</span>
          <span className="faint small">{unsent} unsent · {comments.length - unsent} sent</span>
        </div>
        {comments.length === 0 && <p className="faint small">Select text in the document to add a comment.</p>}
        {anchored.map(({ c, n }) => <Card key={c.id} c={c} n={n} unanchored={false} onDelete={onDelete} />)}
        {lost.length > 0 && <span className="cap">Block not found</span>}
        {lost.map(({ c, n }) => <Card key={c.id} c={c} n={n} unanchored onDelete={onDelete} />)}
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
