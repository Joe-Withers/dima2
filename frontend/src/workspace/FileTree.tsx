import { useEffect, useMemo, useState } from "react";
import { ChangedFile, FileStatus } from "../api";

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
/** "a/b/c.md" -> ["a", "a/b"] */
const ancestors = (p: string) => p.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));

type Props = {
  files: ChangedFile[];
  /** Every file in the worktree: shown as a nested tree instead of the changes. */
  all?: string[];
  selected: string | null;
  onSelect: (path: string) => void;
};

export default function FileTree({ files, all, selected, onSelect }: Props) {
  return all ? <AllFiles paths={all} changes={files} selected={selected} onSelect={onSelect} /> : <Changes files={files} selected={selected} onSelect={onSelect} />;
}

function Row({ path, status, depth, selected, onSelect }: { path: string; status?: FileStatus; depth: number; selected: string | null; onSelect: (path: string) => void }) {
  return (
    <button className={`tree-row${path === selected ? " sel" : ""}`} style={{ paddingLeft: 14 + depth * 14 }} onClick={() => onSelect(path)}>
      <span className={`fname${path.endsWith(".md") ? " md" : ""}`}>{basename(path)}</span>
      {status && <span className={`st st-${status}`}>{status}</span>}
    </button>
  );
}

/** Changed files grouped under their folder, every folder open. */
function Changes({ files, selected, onSelect }: { files: ChangedFile[]; selected: string | null; onSelect: (path: string) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const dirs = [...new Set(files.map((f) => dirname(f.path)))].sort();
  const toggle = (dir: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      return next;
    });

  return (
    <nav className="tree" aria-label="Changed files">
      {dirs.map((dir) => (
        <div key={dir}>
          {dir && (
            <button className="tree-dir" onClick={() => toggle(dir)}>
              <span className="chev">{collapsed.has(dir) ? "›" : "⌄"}</span>
              {dir}
            </button>
          )}
          {!collapsed.has(dir) &&
            files
              .filter((f) => dirname(f.path) === dir)
              .map((f) => <Row key={f.path} path={f.path} status={f.status} depth={dir ? 1 : 0} selected={selected} onSelect={onSelect} />)}
        </div>
      ))}
    </nav>
  );
}

type Dir = { dirs: Map<string, Dir>; files: string[] };

function buildTree(paths: string[]): Dir {
  const root: Dir = { dirs: new Map(), files: [] };
  for (const path of paths) {
    let node = root;
    for (const part of path.split("/").slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part)!;
    }
    node.files.push(path);
  }
  return root;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** Every file as a nested tree; folders start closed, apart from the ones holding the open file. */
function AllFiles({ paths, changes, selected, onSelect }: { paths: string[]; changes: ChangedFile[]; selected: string | null; onSelect: (path: string) => void }) {
  const tree = useMemo(() => buildTree(paths), [paths]);
  const status = useMemo(() => new Map(changes.map((f) => [f.path, f.status])), [changes]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(selected ? ancestors(selected) : []));
  useEffect(() => {
    if (selected) setOpen((o) => new Set([...o, ...ancestors(selected)]));
  }, [selected]);
  const toggle = (dir: string) =>
    setOpen((o) => {
      const next = new Set(o);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      return next;
    });

  function render(node: Dir, prefix: string, depth: number): React.ReactNode[] {
    const dirs = [...node.dirs.keys()].sort(byName).map((name) => {
      const path = prefix + name;
      return (
        <div key={path}>
          <button className="tree-dir" style={{ paddingLeft: 14 + depth * 14 }} onClick={() => toggle(path)}>
            <span className="chev">{open.has(path) ? "⌄" : "›"}</span>
            {name}
          </button>
          {open.has(path) && render(node.dirs.get(name)!, path + "/", depth + 1)}
        </div>
      );
    });
    const files = [...node.files].sort((a, b) => byName(basename(a), basename(b)))
      .map((path) => <Row key={path} path={path} status={status.get(path)} depth={depth} selected={selected} onSelect={onSelect} />);
    return [...dirs, ...files];
  }

  return (
    <nav className="tree" aria-label="All files">
      {render(tree, "", 0)}
    </nav>
  );
}
