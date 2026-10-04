import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Comment, contentUrl } from "../api";
import Markdown from "../markdown/Markdown";
import { findQuote, setHighlight } from "./highlights";

type Draft = { blockId: string; quote: string; top: number; left: number };

type Props = {
  worktreeId: number;
  path: string;
  source: string;
  comments: Comment[];
  onAdd: (c: { block_id: string; quote: string; body: string }) => void;
  /** Ids of comments whose block no longer exists in the document. */
  onUnanchored: (ids: Set<number>) => void;
};

const blockOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-block-id]") ?? null;

/** Resolve an image path in the markdown relative to the markdown file's folder. */
function resolveImage(worktreeId: number, mdPath: string, src: string) {
  if (/^([a-z]+:|\/\/)/i.test(src)) return src;
  const parts = mdPath.split("/").slice(0, -1);
  for (const part of src.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return contentUrl(worktreeId, parts.join("/"));
}

export default function MarkdownPreview({ worktreeId, path, source, comments, onAdd, onUnanchored }: Props) {
  const inner = useRef<HTMLDivElement>(null);
  const [markers, setMarkers] = useState<{ id: number; n: number; top: number; sent: boolean }[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  // Re-rendering markdown on every marker update would be wasteful and would reset diagrams.
  const rendered = useMemo(
    () => <Markdown source={source} resolveImage={(src) => resolveImage(worktreeId, path, src)} />,
    [source, worktreeId, path],
  );

  // Position numbered markers in the gutter next to each commented block, and paint the commented passages.
  useLayoutEffect(() => {
    const root = inner.current!;
    const place = () => {
      const top0 = root.getBoundingClientRect().top;
      const stacked = new Map<string, number>();
      const next: typeof markers = [];
      const ranges = { unsent: [] as Range[], sent: [] as Range[] };
      const missing = new Set<number>();
      comments.forEach((c, i) => {
        const block = root.querySelector(`[data-block-id="${c.block_id}"]`);
        if (!block) return void missing.add(c.id);
        const below = stacked.get(c.block_id) ?? 0;
        stacked.set(c.block_id, below + 1);
        next.push({ id: c.id, n: i + 1, top: block.getBoundingClientRect().top - top0 + 3 + below * 26, sent: !!c.sent_at });
        const range = findQuote(root, block, c.quote);
        if (range) ranges[c.sent_at ? "sent" : "unsent"].push(range);
      });
      setMarkers(next);
      onUnanchored(missing);
      setHighlight("comment-unsent", ranges.unsent);
      setHighlight("comment-sent", ranges.sent);
    };
    place();
    const observer = new ResizeObserver(place); // diagrams and images change heights after first paint
    observer.observe(root);
    return () => {
      observer.disconnect();
      setHighlight("comment-unsent", []);
      setHighlight("comment-sent", []);
    };
  }, [comments, source]);

  useEffect(() => setDraft(null), [path]);

  // Any mouse selection inside the document starts a comment, including drags across several blocks.
  // Listening on the document means releasing the mouse outside the article still counts.
  useEffect(() => {
    const onSelected = (e: Event) => {
      if ((e.target as Element).closest?.(".popover")) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      const root = inner.current!;
      const block = blockOf(range.startContainer);
      const quote = range.toString().replace(/\s+/g, " ").trim();
      if (!block || !root.contains(range.endContainer) || !quote) return;
      const box = range.getBoundingClientRect();
      setHighlight("comment-draft", [range.cloneRange()]);
      setBody("");
      setDraft({ blockId: block.dataset.blockId!, quote, top: box.bottom - root.getBoundingClientRect().top + 8, left: 40 });
    };
    document.addEventListener("mouseup", onSelected);
    return () => {
      document.removeEventListener("mouseup", onSelected);
    };
  }, []);

  function close() {
    window.getSelection()?.removeAllRanges();
    setDraft(null);
    setHighlight("comment-draft", []);
  }

  function submit() {
    if (!draft || !body.trim()) return;
    onAdd({ block_id: draft.blockId, quote: draft.quote, body: body.trim() });
    close();
  }

  return (
    <article className="doc-scroll">
      <div className="doc" ref={inner}>
        {markers.map((m) => (
          <span key={m.id} className={`mk${m.sent ? " sent" : ""}`} style={{ top: m.top }} aria-label={`Comment ${m.n}${m.sent ? ", sent" : ""}`}>
            {m.n}
          </span>
        ))}
        {rendered}
        {draft && (
          <div role="dialog" aria-label="New comment" className="popover" style={{ top: draft.top, left: draft.left }}>
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
    </article>
  );
}
