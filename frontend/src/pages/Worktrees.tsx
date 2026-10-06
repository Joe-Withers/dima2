import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import NewWorktreeDialog from "../NewWorktreeDialog";
import Page from "../Page";
import { projectColor } from "../projectColor";
import { timeAgo } from "../timeAgo";
import { Archive, Eye, Home } from "../workspace/icons";
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
  const adopt = useMutation({
    mutationFn: api.adoptWorktree,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["worktrees"] }),
    onError: (e) => alert(e.message),
  });
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const all = worktrees.data ?? [];
  const active = all.filter((w) => !w.archived_at && !w.unmanaged && !w.main);
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
        <button className="iconbtn plus" aria-label="New worktree" title="New worktree" onClick={() => setCreating(true)}>+</button>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Project</th><th>Branch</th><th>Status</th><th>Changes</th><th>vs base</th><th>Last activity</th><th /></tr>
          </thead>
          <tbody>
            {visible.map((w) => (
              <tr key={w.unmanaged ? `u:${w.path}` : w.id} className={w.archived_at || w.unmanaged ? "archived" : undefined}>
                <td><span className="swatch" style={{ background: projectColor(w.project) }} />{w.project}</td>
                <td className="mono">
                  {w.unmanaged ? <>{w.branch}<span className="muted"> · not tracked</span></> : w.archived_at ? <>{w.branch}<span className="muted"> · archived</span></> : (
                    <Link className="branch" to={`/worktrees/${w.id}`}>
                      {w.main && <span className="main-mark" title="Main checkout: work directly in the project folder, not a worktree"><Home /></span>}
                      {w.review && <span className="main-mark" title="Review: someone else's branch"><Eye /></span>}
                      {w.branch}
                    </Link>
                  )}
                  {w.main && !w.archived_at && <span className="muted"> · main checkout</span>}
                  {w.done && <span className="badge">done</span>}
                </td>
                <td>
                  {!w.archived_at && !w.unmanaged && (
                    <>
                      <span className={`pill s-${w.status}`}><span className="d" />{w.status.replace("_", " ")}</span>
                      <span className="faint small"> {w.sessions} session{w.sessions === 1 ? "" : "s"}</span>
                    </>
                  )}
                </td>
                <td className="mono">
                  {!w.unmanaged && <>{w.files} files{w.md_files > 0 && <span className="accent"> · {w.md_files} md</span>}</>}
                </td>
                <td className="mono muted">{!w.unmanaged && !w.main && <>↑{w.ahead} ↓{w.behind}</>}</td>
                <td className="muted">{!w.unmanaged && timeAgo(w.last_activity)}</td>
                <td style={{ textAlign: "right" }}>
                  {w.unmanaged && (
                    <button className="iconbtn plus" aria-label={`Track ${w.branch}`} title="Track in dima2" onClick={() => adopt.mutate({ project_id: w.project_id, branch: w.branch, path: w.path! })}>+</button>
                  )}
                  {!w.archived_at && !w.unmanaged && !w.main && (
                    <button className="iconbtn" aria-label={`Archive ${w.branch}`} title="Archive" onClick={() => confirm(`Archive ${w.branch}? This removes its folder.`) && archive.mutate(w.id)}>
                      <Archive />
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
