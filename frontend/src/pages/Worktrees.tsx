import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import NewWorktreeDialog from "../NewWorktreeDialog";
import Page from "../Page";
import { projectColor } from "../projectColor";
import { timeAgo } from "../timeAgo";
import { useAttentionCount, useWorktrees } from "../useWorktrees";

export default function Worktrees() {
  const qc = useQueryClient();
  const worktrees = useWorktrees();
  const attention = useAttentionCount();
  const archive = useMutation({
    mutationFn: api.archiveWorktree,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worktrees"] }),
    onError: (e) => alert(e.message),
  });
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const all = worktrees.data ?? [];
  const active = all.filter((w) => !w.archived_at);
  const projectNames = [...new Set(all.map((w) => w.project))].sort();
  const visible = all.filter(
    (w) =>
      (showArchived || !w.archived_at) &&
      (!project || w.project === project) &&
      w.branch.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Page>
      <div className="row baseline">
        <h1>Worktrees</h1>
        <span className="muted">
          {active.length} active across {new Set(active.map((w) => w.project)).size} projects
        </span>
        {attention > 0 && <span className="attention"><span className="badge">{attention}</span>need your attention</span>}
      </div>
      <div className="row">
        <select className="ctl" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projectNames.map((n) => <option key={n}>{n}</option>)}
        </select>
        <input className="ctl" type="search" placeholder="Search branches" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="muted check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <span className="grow" />
        <button className="btn primary" onClick={() => setCreating(true)}>+ New worktree</button>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Project</th><th>Branch</th><th>Status</th><th>Changes</th><th>vs base</th><th>Last activity</th><th /></tr>
          </thead>
          <tbody>
            {visible.map((w) => (
              <tr key={w.id} className={w.archived_at ? "archived" : undefined}>
                <td><span className="swatch" style={{ background: projectColor(w.project) }} />{w.project}</td>
                <td className="mono">
                  {w.archived_at ? <>{w.branch}<span className="muted"> · archived</span></> : <Link className="branch" to={`/worktrees/${w.id}`}>{w.branch}</Link>}
                  {w.done && <span className="badge">done</span>}
                </td>
                <td>
                  {!w.archived_at && (
                    <>
                      <span className={`pill s-${w.status}`}><span className="d" />{w.status.replace("_", " ")}</span>
                      <span className="faint small"> {w.sessions} session{w.sessions === 1 ? "" : "s"}</span>
                    </>
                  )}
                </td>
                <td className="mono">
                  {w.files} files
                  {w.md_files > 0 && <span className="accent"> · {w.md_files} md</span>}
                </td>
                <td className="mono muted">↑{w.ahead} ↓{w.behind}</td>
                <td className="muted">{timeAgo(w.last_activity)}</td>
                <td>
                  {!w.archived_at && (
                    <button className="btn" onClick={() => confirm(`Archive ${w.branch}? This removes its folder.`) && archive.mutate(w.id)}>
                      Archive
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="empty">No worktrees to show.</p>}
      </div>
      {creating && <NewWorktreeDialog onClose={() => setCreating(false)} />}
    </Page>
  );
}
