import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { Trash } from "../workspace/icons";
import FolderBrowser from "../FolderBrowser";
import Page from "../Page";
import { projectColor } from "../projectColor";

export default function Projects() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const refresh = () => qc.invalidateQueries({ queryKey: ["projects"] });
  const add = useMutation({ mutationFn: api.addProject, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.removeProject, onSuccess: refresh });
  const [browsing, setBrowsing] = useState(false);

  return (
    <Page>
      <div className="row">
        <h1 className="grow">Projects</h1>
        <button className="iconbtn plus" aria-label="Add project" onClick={() => setBrowsing(true)}>+</button>
      </div>
      {browsing && (
        <FolderBrowser
          start=""
          onPick={(path) => (add.mutate({ name: path.split("/").pop()!, root_path: path }), setBrowsing(false))}
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
                <td style={{ textAlign: "right" }}>
                  <button className="iconbtn" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => confirm(`Remove ${p.name}? Its worktrees stay on disk.`) && remove.mutate(p.id)}><Trash /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {projects.data?.length === 0 && <p className="empty">No projects yet. Click + to add a git repository.</p>}
      </div>
    </Page>
  );
}
