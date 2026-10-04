import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api } from "./api";

export default function NewWorktreeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const [projectId, setProjectId] = useState<number>();
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState<string>();

  const selected = projectId ?? projects.data?.[0]?.id;
  const refs = useQuery({
    queryKey: ["refs", selected],
    queryFn: () => api.refs(selected!),
    enabled: selected !== undefined,
  });
  const baseRef = base ?? refs.data?.default ?? "";
  const folder = branch.replaceAll("/", "-");

  const create = useMutation({
    mutationFn: api.addWorktree,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worktrees"] });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ project_id: selected!, branch: branch.trim(), base_ref: baseRef });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog" role="dialog" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="dlg-title">New worktree</h2>
        <label>
          Project
          <select className="ctl" value={selected ?? ""} onChange={(e) => (setProjectId(Number(e.target.value)), setBase(undefined))}>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.root_path}</option>)}
          </select>
        </label>
        <label>
          Branch name
          <input className="ctl mono" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="feat/my-change" required autoFocus />
          {folder && <span className="help">Folder: <span className="mono">.worktrees/{folder}</span></span>}
        </label>
        <label>
          Branch from
          <select className="ctl mono" value={baseRef} onChange={(e) => setBase(e.target.value)}>
            {refs.data?.refs.map((r) => <option key={r}>{r}</option>)}
          </select>
          <span className="help">Uncommitted changes in your main checkout don't affect this.</span>
        </label>
        {baseRef && branch && <code className="cmd">git worktree add .worktrees/{folder} -b {branch} {baseRef}</code>}
        {create.error && <p className="error">{create.error.message}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!selected || create.isPending}>Create worktree</button>
        </div>
      </form>
    </div>
  );
}
