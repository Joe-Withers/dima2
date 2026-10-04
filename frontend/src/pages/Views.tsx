import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, ViewEntry } from "../api";
import Markdown from "../markdown/Markdown";
import Page from "../Page";

const GROUPS: Record<string, string> = { Agents: ".claude/agents", Skills: ".claude/skills", Commands: ".claude/commands", Flows: ".thenn" };

export default function Views() {
  const [params, setParams] = useSearchParams();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const projectId = Number(params.get("project")) || projects.data?.[0]?.id;
  const selected = params.get("item");
  const select = (next: Record<string, string>) => setParams({ ...(projectId ? { project: String(projectId) } : {}), ...next });

  const entries = useQuery({ queryKey: ["views", projectId], queryFn: () => api.views(projectId!), enabled: !!projectId });
  const file = useQuery({ queryKey: ["view", projectId, selected], queryFn: () => api.viewFile(projectId!, selected!), enabled: !!projectId && !!selected });

  const byGroup = (group: string) => (entries.data ?? []).filter((e: ViewEntry) => e.group === group);
  const isMarkdown = selected?.endsWith(".md");

  return (
    <Page>
      <div className="row">
        <h1>Views</h1>
        <span className="muted">What each project defines for its agents. Read-only.</span>
        <span className="grow" />
        <label className="muted" htmlFor="vp">Project</label>
        <select id="vp" className="ctl" value={projectId ?? ""} onChange={(e) => setParams({ project: e.target.value })}>
          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="views">
        <nav className="card views-nav" aria-label="Definitions">
          {Object.entries(GROUPS).map(([group, directory]) => {
            const items = byGroup(group);
            return (
              <div key={group}>
                <div className="grp"><span>{group}</span><span className="mono">{directory}</span></div>
                {items.length === 0 && <p className="faint small item-none">None found</p>}
                {items.map((e) => (
                  <button key={e.path} className={`item${e.path === selected ? " on" : ""}`} onClick={() => select({ item: e.path })}>{e.name}</button>
                ))}
              </div>
            );
          })}
        </nav>
        <article className="card view-file">
          {file.data ? (
            <>
              <div className="view-head">
                <span className="mono">{file.data.path}</span>
                <span className="chip">Read-only</span>
              </div>
              <div className="view-body">
                {Object.keys(file.data.frontmatter).length > 0 && (
                  <table className="fm">
                    <tbody>
                      {Object.entries(file.data.frontmatter).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
                    </tbody>
                  </table>
                )}
                {isMarkdown ? <div className="doc plain"><Markdown source={file.data.body} /></div> : <pre className="mono flow">{file.data.body}</pre>}
              </div>
            </>
          ) : (
            <p className="empty">Select a definition to view it.</p>
          )}
        </article>
      </div>
    </Page>
  );
}
