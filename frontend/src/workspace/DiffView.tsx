import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, FileStatus } from "../api";
import CommentRail from "./CommentRail";
import PanelHeader from "./PanelHeader";
import { useComments } from "./useComments";

type Line = { kind: "hunk" | "add" | "del" | "ctx"; old?: number; new?: number; text: string };

/** Parse a unified diff into display lines with old/new line numbers. */
export function parseDiff(diff: string): Line[] {
  const lines: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const text of diff.split("\n")) {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (hunk) {
      [oldNo, newNo, inHunk] = [Number(hunk[1]), Number(hunk[2]), true];
      lines.push({ kind: "hunk", text });
    } else if (!inHunk || text.startsWith("\\")) {
      continue;
    } else if (text.startsWith("+")) {
      lines.push({ kind: "add", new: newNo++, text: text.slice(1) });
    } else if (text.startsWith("-")) {
      lines.push({ kind: "del", old: oldNo++, text: text.slice(1) });
    } else {
      lines.push({ kind: "ctx", old: oldNo++, new: newNo++, text: text.slice(1) });
    }
  }
  return lines;
}

/** A whole file as context lines, so comments on it anchor ("new:<n>") the same way as in a diff. */
function fileLines(text: string): Line[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((t, i) => ({ kind: "ctx", new: i + 1, text: t }));
}

const SIGN = { hunk: "", add: "+", del: "−", ctx: "" };

/** Comments anchor to a diff line: "new:<n>" for lines in the new file, "old:<n>" for removed ones. */
const lineKey = (l: Line) => (l.kind === "hunk" ? null : l.kind === "del" ? `old:${l.old}` : `new:${l.new}`);
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

type Props = {
  worktreeId: number;
  path: string;
  /** Unset for a file the branch hasn't changed: it is shown whole, numbered like the new side of a diff. */
  status?: FileStatus;
  /** Active terminal tab: its id and display name. */
  target: { id: number; name: string } | null;
  onOpenFile: (path: string) => void;
};

type Draft = { key: string; quote: string; top: number };

export default function DiffView({ worktreeId, path, status, target, onOpenFile }: Props) {
  const unchanged = status === undefined;
  const { data } = useQuery({
    queryKey: ["diff", worktreeId, path, unchanged],
    queryFn: async () => (unchanged ? { diff: "", text: await api.content(worktreeId, path) } : { ...(await api.diff(worktreeId, path)), text: null }),
    refetchInterval: 3000,
  });
  const c = useComments(worktreeId, path, target);
  const inner = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const binary = data?.text?.includes("\0") || data?.diff.includes("Binary");
  const lines = useMemo(() => (!data || binary ? [] : data.text !== null ? fileLines(data.text) : parseDiff(data.diff)), [data, binary]);
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;

  // Numbered markers per commented line; a comment loses its anchor when its line is gone or its text changed.
  const { marks, unanchored } = useMemo(() => {
    const byKey = new Map(lines.flatMap((l) => (lineKey(l) ? [[lineKey(l)!, l] as const] : [])));
    const marks = new Map<string, { id: number; n: number; sent: boolean }[]>();
    const unanchored = new Set<number>();
    c.fileComments.forEach((comment, i) => {
      const line = byKey.get(comment.block_id);
      if (!line || !collapse(line.text).includes(collapse(comment.quote.split("\n")[0]))) return void unanchored.add(comment.id);
      marks.set(comment.block_id, [...(marks.get(comment.block_id) ?? []), { id: comment.id, n: i + 1, sent: !!comment.sent_at }]);
    });
    return { marks, unanchored };
  }, [lines, c.fileComments]);

  useEffect(() => setDraft(null), [path]);

  // Any mouse selection inside the diff starts a comment, anchored to the line it starts on.
  useEffect(() => {
    const onSelected = (e: Event) => {
      if ((e.target as Element).closest?.(".popover")) return;
      const selection = window.getSelection();
      const root = inner.current;
      if (!selection || selection.isCollapsed || !root) return;
      const range = selection.getRangeAt(0);
      const rowOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-line]") ?? null;
      const first = rowOf(range.startContainer);
      if (!first || !root.contains(range.endContainer)) return;
      const rows = [...root.querySelectorAll<HTMLElement>("[data-line]")];
      const last = rowOf(range.endContainer) ?? first;
      const span = rows.slice(rows.indexOf(first), rows.indexOf(last) + 1);
      const quote = span.length > 1 ? span.map((r) => r.querySelector(".code")!.textContent).join("\n") : collapse(range.toString());
      if (!quote.trim()) return;
      setBody("");
      setDraft({ key: first.dataset.line!, quote, top: range.getBoundingClientRect().bottom - root.getBoundingClientRect().top + 8 });
    };
    document.addEventListener("mouseup", onSelected);
    return () => document.removeEventListener("mouseup", onSelected);
  }, []);

  function close() {
    window.getSelection()?.removeAllRanges();
    setDraft(null);
  }

  function submit() {
    if (!draft || !body.trim()) return;
    c.add({ block_id: draft.key, quote: draft.quote, body: body.trim() });
    close();
  }

  return (
    <div className="center">
      <PanelHeader path={path} status={status}>
        {!unchanged && (
          <>
            <span className="mono st-A small">+{added}</span>
            <span className="mono st-D small">−{removed}</span>
          </>
        )}
      </PanelHeader>
      <div className="review">
        <div className={`diff mono${unchanged ? " whole" : ""}`}>
          {data && lines.length === 0 && <p className="empty">{binary ? "Binary file." : unchanged ? "Empty file." : "No textual changes."}</p>}
          <div className="diff-inner" ref={inner}>
            {lines.map((l, i) => {
              const key = lineKey(l);
              const here = key ? marks.get(key) : undefined;
              return (
                <div key={i} className={`dl dl-${l.kind}${here ? (here.some((m) => !m.sent) ? " has-c" : " has-c sent") : ""}`} data-line={key ?? undefined}>
                  <span className="gut">{here?.map((m) => <span key={m.id} className={`mk static${m.sent ? " sent" : ""}`} aria-label={`Comment ${m.n}${m.sent ? ", sent" : ""}`}>{m.n}</span>)}</span>
                  <span className="no">{l.old}</span>
                  <span className="no">{l.new}</span>
                  <span className="sign">{SIGN[l.kind]}</span>
                  <span className="code">{l.text}</span>
                </div>
              );
            })}
            {draft && (
              <div role="dialog" aria-label="New comment" className="popover" style={{ top: draft.top, left: 144 }}>
                <textarea
                  className="ta"
                  rows={2}
                  autoFocus
                  aria-label="Comment on selection"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                    if (e.key === "Escape") close();
                  }}
                />
                <div className="actions">
                  <button className="btn small" onClick={close}>Cancel</button>
                  <button className="btn primary small" onClick={submit} disabled={!body.trim()}>Add comment</button>
                </div>
              </div>
            )}
          </div>
        </div>
        <CommentRail
          comments={c.railComments}
          path={path}
          scope={c.scope}
          onScope={c.setScope}
          showSent={c.showSent}
          onShowSent={c.setShowSent}
          unanchored={unanchored}
          target={target?.name ?? null}
          onEdit={c.edit}
          onDelete={c.remove}
          onSend={c.send}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}
