import { useState } from "react";
import { ChangedFile } from "../api";

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

type Props = { files: ChangedFile[]; selected: string | null; onSelect: (path: string) => void };

export default function FileTree({ files, selected, onSelect }: Props) {
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
              .map((f) => (
                <button
                  key={f.path}
                  className={`tree-row${f.path === selected ? " sel" : ""}`}
                  style={{ paddingLeft: dir ? 28 : 14 }}
                  onClick={() => onSelect(f.path)}
                >
                  <span className={`fname${f.path.endsWith(".md") ? " md" : ""}`}>{basename(f.path)}</span>
                  <span className={`st st-${f.status}`}>{f.status}</span>
                </button>
              ))}
        </div>
      ))}
    </nav>
  );
}
