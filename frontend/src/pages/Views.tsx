import { useState } from "react";
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
  const selectedScope = params.get("scope") ?? "project";
  const [search, setSearch] = useState("");
  const select = (e: ViewEntry) => setParams({ ...(projectId ? { project: String(projectId) } : {}), item: e.path, scope: e.scope });

  const entries = useQuery({ queryKey: ["views", projectId], queryFn: () => api.views(projectId!), enabled: !!projectId });
  const file = useQuery({ queryKey: ["view", projectId, selected, selectedScope], queryFn: () => api.viewFile(projectId!, selected!, selectedScope), enabled: !!projectId && !!selected });

  const needle = search.trim().toLowerCase();
  const matches = (e: ViewEntry) => !needle || e.name.toLowerCase().includes(needle) || e.path.toLowerCase().includes(needle);
  const byGroup = (group: string) => (entries.data ?? []).filter((e: ViewEntry) => e.group === group && matches(e));
  const isMarkdown = selected?.endsWith(".md");

  return (
    <Page>
      <div className="row">
        <h1>Views</h1>
        <span className="muted">What the project and your global setup define for agents. Read-only.</span>
        <span className="grow" />
        <label className="muted" htmlFor="vp">Project</label>
        <select id="vp" className="ctl" value={projectId ?? ""} onChange={(e) => setParams({ project: e.target.value })}>
          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="views">
        <nav className="card views-nav" aria-label="Definitions">
          <input className="ctl views-search" type="search" placeholder="Search definitions" aria-label="Search definitions" value={search} onChange={(e) => setSearch(e.target.value)} />
          {Object.entries(GROUPS).map(([group, directory]) => {
            const items = byGroup(group);
            if (needle && items.length === 0) return null;
            return (
              <div key={group}>
                <div className="grp"><span>{group}</span><span className="mono">{directory}</span></div>
                {items.length === 0 && <p className="faint small item-none">None found</p>}
                {items.map((e) => (
                  <button key={`${e.scope}:${e.path}`} className={`item${e.path === selected && e.scope === selectedScope ? " on" : ""}`} onClick={() => select(e)}>
                    <span className="item-name">{e.name}</span>
                    {e.scope === "global" && <span className="chip">Global</span>}
                  </button>
                ))}
              </div>
            );
          })}
          {needle && !(entries.data ?? []).some(matches) && <p className="faint small item-none">No matches</p>}
        </nav>
        <article className="card view-file">
          {file.data ? (
            <>
              <div className="view-head">
                <span className="mono">{file.data.path}</span>
                <span className="chip">{file.data.scope === "global" ? "Global · Read-only" : "Read-only"}</span>
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
