import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api } from "./api";

export default function NewWorktreeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const [projectId, setProjectId] = useState<number>();
  const [existing, setExisting] = useState(false);
  const [review, setReview] = useState(false);
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState<string>();

  const selected = projectId ?? projects.data?.[0]?.id;
  const refs = useQuery({
    queryKey: ["refs", selected],
    queryFn: () => api.refs(selected!),
    enabled: selected !== undefined,
  });
  const baseRef = base ?? refs.data?.default ?? "";
  // a remote branch that's already local is offered once, by its local name
  const local = refs.data?.local ?? [];
  const choices = [...local, ...(refs.data?.remote ?? []).filter((r) => !local.includes(r.split("/").slice(1).join("/")))];
  const localName = existing && !local.includes(branch) && choices.includes(branch) ? branch.split("/").slice(1).join("/") : branch;
  const folder = localName.replaceAll("/", "-");

  const fetchBranches = useMutation({
    mutationFn: () => api.fetch(selected!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["refs", selected] }),
  });
  const create = useMutation({
    mutationFn: api.addWorktree,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worktrees"] });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ project_id: selected!, branch: branch.trim(), base_ref: baseRef, existing, review });
  }

  function chooseMode(isExisting: boolean) {
    setExisting(isExisting);
    setBranch("");
    if (!isExisting) setReview(false);
  }

  const command = existing
    ? local.includes(branch)
      ? `git worktree add .worktrees/${folder} ${branch}`
      : `git worktree add --track -b ${localName} .worktrees/${folder} ${branch}`
    : `git worktree add .worktrees/${folder} -b ${branch} ${baseRef}`;

  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog" role="dialog" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="dlg-title">New worktree</h2>
        <label>
          Project
          <select className="ctl" value={selected ?? ""} onChange={(e) => (setProjectId(Number(e.target.value)), setBase(undefined), setBranch(""))}>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.root_path}</option>)}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Branch">
          <button type="button" className={existing ? undefined : "on"} onClick={() => chooseMode(false)}>New branch</button>
          <button type="button" className={existing ? "on" : undefined} onClick={() => chooseMode(true)}>Existing branch</button>
        </div>
        {existing ? (
          <label>
            Branch
            <div className="row">
              <input className="ctl mono grow" list="dlg-branches" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Search local and remote branches" required autoFocus />
              <button type="button" className="btn" disabled={!selected || fetchBranches.isPending} onClick={() => fetchBranches.mutate()} title="git fetch --all --prune">
                {fetchBranches.isPending ? "Fetching…" : "Fetch"}
              </button>
            </div>
            <datalist id="dlg-branches">{choices.map((r) => <option key={r} value={r} />)}</datalist>
            {fetchBranches.error && <span className="error">{fetchBranches.error.message}</span>}
            {folder && <span className="help">Folder: <span className="mono">.worktrees/{folder}</span></span>}
          </label>
        ) : (
          <label>
            Branch name
            <input className="ctl mono" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="feat/my-change" required autoFocus />
            {folder && <span className="help">Folder: <span className="mono">.worktrees/{folder}</span></span>}
          </label>
        )}
        <label>
          {existing ? "Compare against" : "Branch from"}
          <select className="ctl mono" value={baseRef} onChange={(e) => setBase(e.target.value)}>
            {refs.data?.refs.map((r) => <option key={r}>{r}</option>)}
          </select>
          <span className="help">
            {existing ? "Changes and ↑↓ counts are shown relative to this, like a PR's target branch." : "Uncommitted changes in your main checkout don't affect this."}
          </span>
        </label>
        {existing && (
          <label className="check muted">
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
            Reviewing someone else's branch
          </label>
        )}
        {baseRef && branch && <code className="cmd">{command}</code>}
        {create.error && <p className="error">{create.error.message}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!selected || create.isPending || (existing && !choices.includes(branch))}>Create worktree</button>
        </div>
      </form>
    </div>
  );
}
