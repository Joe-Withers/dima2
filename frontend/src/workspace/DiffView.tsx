import { useQuery } from "@tanstack/react-query";
import { api, FileStatus } from "../api";
import PanelHeader from "./PanelHeader";

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

const SIGN = { hunk: "", add: "+", del: "−", ctx: "" };

type Props = { worktreeId: number; path: string; status: FileStatus };

export default function DiffView({ worktreeId, path, status }: Props) {
  const { data } = useQuery({
    queryKey: ["diff", worktreeId, path],
    queryFn: () => api.diff(worktreeId, path),
    refetchInterval: 3000,
  });
  const lines = data ? parseDiff(data.diff) : [];
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;

  return (
    <div className="center">
      <PanelHeader path={path} status={status}>
        <span className="mono st-A small">+{added}</span>
        <span className="mono st-D small">−{removed}</span>
      </PanelHeader>
      <div className="diff mono">
        {data && lines.length === 0 && <p className="empty">{data.diff.includes("Binary") ? "Binary file." : "No textual changes."}</p>}
        {lines.map((l, i) => (
          <div key={i} className={`dl dl-${l.kind}`}>
            <span className="no">{l.old}</span>
            <span className="no">{l.new}</span>
            <span className="sign">{SIGN[l.kind]}</span>
            <span className="code">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
