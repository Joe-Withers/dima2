import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api } from "../api";
import { Folder } from "../workspace/icons";
import FolderBrowser from "../FolderBrowser";
import Page from "../Page";
import { projectColor } from "../projectColor";

export default function Projects() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const refresh = () => qc.invalidateQueries({ queryKey: ["projects"] });
  const add = useMutation({ mutationFn: api.addProject, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.removeProject, onSuccess: refresh });
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [browsing, setBrowsing] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate({ name, root_path: rootPath }, { onSuccess: () => (setName(""), setRootPath("")) });
  }

  return (
    <Page>
      <h1>Projects</h1>
      <form className="row" onSubmit={submit}>
        <input className="ctl" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="path-field grow">
          <input className="ctl mono" placeholder="/path/to/git/repo" value={rootPath} onChange={(e) => setRootPath(e.target.value)} required />
          <button type="button" className="iconbtn" aria-label="Browse folders" onClick={() => setBrowsing(true)}><Folder /></button>
        </div>
        <button className="btn primary">Add project</button>
      </form>
      {browsing && (
        <FolderBrowser
          start={rootPath}
          onPick={(path) => (setRootPath(path), setName((n) => n || path.split("/").pop()!), setBrowsing(false))}
          onClose={() => setBrowsing(false)}
        />
      )}
      {add.error && <p className="error">{add.error.message}</p>}
      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Path</th><th>Host</th><th /></tr>
          </thead>
          <tbody>
            {projects.data?.map((p) => (
              <tr key={p.id}>
                <td><span className="swatch" style={{ background: projectColor(p.name) }} />{p.name}</td>
                <td className="mono">{p.root_path}</td>
                <td>{p.host}</td>
                <td>
                  <button className="btn" onClick={() => confirm(`Remove ${p.name}? Its worktrees stay on disk.`) && remove.mutate(p.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {projects.data?.length === 0 && <p className="empty">No projects yet. Add a git repository above.</p>}
      </div>
    </Page>
  );
}
