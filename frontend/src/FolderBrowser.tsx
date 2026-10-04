import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api";

type Props = { start: string; onPick: (path: string) => void; onClose: () => void };

/** Navigate folders on the machine running the backend and pick one. */
export default function FolderBrowser({ start, onPick, onClose }: Props) {
  const [path, setPath] = useState(start);
  const dir = useQuery({ queryKey: ["fs", path], queryFn: () => api.directory(path), retry: false });
  // An unreadable start path falls back to the home folder.
  if (dir.error && path) setPath("");

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Choose folder" onClick={(e) => e.stopPropagation()}>
        <h2>Choose folder</h2>
        <div className="mono small crumbs">{dir.data?.path ?? "…"}{dir.data?.is_repo && <span className="chip repo">git repo</span>}</div>
        <div className="folder-list">
          {dir.data?.parent && <button className="item" onClick={() => setPath(dir.data!.parent!)}>..</button>}
          {dir.data?.dirs.map((d) => (
            <button key={d.name} className="item" onClick={() => setPath(`${dir.data!.path}/${d.name}`)}>
              {d.name}
              {d.is_repo && <span className="chip repo">git</span>}
            </button>
          ))}
          {dir.data?.dirs.length === 0 && <p className="faint small">No subfolders.</p>}
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!dir.data} onClick={() => onPick(dir.data!.path)}>Select this folder</button>
        </div>
      </div>
    </div>
  );
}
