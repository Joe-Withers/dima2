import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { projectColor } from "../projectColor";
import DiffView from "./DiffView";
import FileTree from "./FileTree";
import { Back } from "./icons";
import ReviewPane from "./ReviewPane";
import SessionTabs from "./SessionTabs";
import Terminal from "./Terminal";
import { useLayout } from "./useLayout";

export default function Workspace() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = params.get("file");
  const layout = useLayout();
  const region = useRef<HTMLDivElement>(null);
  const [chosenSession, setChosenSession] = useState<number | null>(null);

  const worktree = useQuery({ queryKey: ["worktree", id], queryFn: () => api.worktree(id), refetchInterval: 3000 });
  const sessions = useQuery({ queryKey: ["sessions", id], queryFn: () => api.sessions(id), refetchInterval: 3000 });
  const refreshSessions = () => qc.invalidateQueries({ queryKey: ["sessions", id] });

  const addSession = useMutation({
    mutationFn: () => api.addSession(id),
    onSuccess: (s) => (setChosenSession(s.id), refreshSessions()),
  });
  const closeSession = useMutation({ mutationFn: api.closeSession, onSuccess: refreshSessions });
  const archive = useMutation({
    mutationFn: () => api.archiveWorktree(id),
    onSuccess: () => navigate("/worktrees"),
    onError: (e) => alert(e.message),
  });

  // Looking at a worktree acknowledges "done" for its sessions.
  const hasDone = sessions.data?.some((s) => s.agent_state === "done");
  useEffect(() => {
    if (hasDone) api.markSeen(id).then(() => qc.invalidateQueries({ queryKey: ["worktrees"] }));
  }, [hasDone, id]);

  const w = worktree.data;
  if (!w) return <p className="empty">{worktree.error ? worktree.error.message : "Loading…"}</p>;

  const list = sessions.data ?? [];
  const active = list.find((s) => s.id === chosenSession) ?? list[list.length - 1] ?? null;
  const file = w.files.find((f) => f.path === selected);
  const mdCount = w.files.filter((f) => f.path.endsWith(".md")).length;
  const target = active && { id: active.id, name: `session ${list.indexOf(active) + 1}` };

  function startDrag(e: React.PointerEvent) {
    const box = region.current!.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => layout.setRatio((ev.clientY - box.top) / box.height);
    const stop = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", stop));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  const flex = {
    balanced: [`${layout.ratio} 1 0`, `${1 - layout.ratio} 1 0`],
    top: ["1 1 0", "0 0 40px"],
    bottom: ["0 0 40px", "1 1 0"],
  }[layout.mode];

  return (
    <div className="workspace">
      <div className="ws-head">
        <Link to="/worktrees" className="back"><Back />Worktrees</Link>
        <span className="vr" />
        <span className="crumb">
          <span className="swatch" style={{ background: projectColor(w.project) }} />
          <span className="muted">{w.project}</span>
          <span className="faint">/</span>
          <span className="mono strong">{w.branch}</span>
        </span>
        <span className="mono muted small">↑{w.ahead} ↓{w.behind} vs {w.base_ref}</span>
        <span className="mono muted small">{w.files.length} files{mdCount > 0 && <span className="accent"> · {mdCount} md</span>}</span>
        <span className="grow" />
        <button className="btn" onClick={() => confirm(`Archive ${w.branch}? This removes its folder.`) && archive.mutate()}>Archive</button>
      </div>

      <div className="regions" ref={region}>
        <section aria-label="Files" className="region top" style={{ flex: flex[0] }} onClick={layout.mode === "bottom" ? layout.restore : undefined}>
          <div className="phead tree-head"><span className="cap">Changes</span><span className="mono faint small">{w.files.length}</span></div>
          <FileTree files={w.files} selected={selected} onSelect={(path) => setParams({ file: path })} />
          {file ? (
            file.path.endsWith(".md") && file.status !== "D" ? (
              <ReviewPane key={file.path} worktreeId={id} path={file.path} status={file.status} target={target} />
            ) : (
              <DiffView key={file.path} worktreeId={id} path={file.path} status={file.status} />
            )
          ) : (
            <div className="center">
              <div className="phead grow-cell"><span className="faint small">No file selected</span></div>
              <p className="empty hint">Select a file to view, or just use the terminal below.</p>
            </div>
          )}
        </section>

        <div className="divider" onPointerDown={startDrag} aria-hidden="true"><span /></div>

        <section aria-label="Terminal sessions" className="region bottom" style={{ flex: flex[1] }} onClick={layout.mode === "top" ? layout.restore : undefined}>
          <SessionTabs
            sessions={list}
            active={active?.id ?? null}
            onSelect={setChosenSession}
            onAdd={addSession.mutate}
            onClose={closeSession.mutate}
            onStep={layout.step}
          />
          {active ? <Terminal key={active.id} sessionId={active.id} /> : <p className="empty hint">No sessions yet. Press + to start a shell.</p>}
        </section>
      </div>
    </div>
  );
}
