export type Project = { id: number; name: string; root_path: string; host: string };

export type Status = "running" | "needs_input" | "idle" | "exited";

export type Worktree = {
  id: number;
  project_id: number;
  project: string;
  branch: string;
  base_ref: string;
  files: number;
  md_files: number;
  ahead: number;
  behind: number;
  last_activity: number;
  archived_at: number | null;
  sessions: number;
  status: Status;
  /** An agent finished its turn and the worktree hasn't been opened since. */
  done: boolean;
  /** Exists in git but has no dima2 record yet; `path` is set only for these. */
  unmanaged?: boolean;
  path?: string;
};

export type FileStatus = "A" | "M" | "D";
export type ChangedFile = { path: string; status: FileStatus };

export type WorktreeDetail = {
  id: number;
  project_id: number;
  project: string;
  branch: string;
  base_ref: string;
  archived_at: number | null;
  ahead: number;
  behind: number;
  files: ChangedFile[];
};

export type Session = {
  id: number;
  command: string;
  alive: boolean;
  running: boolean;
  agent_state: "running" | "needs_input" | "done" | null;
};

export type Comment = {
  id: number;
  file_path: string;
  block_id: string;
  quote: string;
  body: string;
  created_at: number;
  sent_at: number | null;
  sent_to: string | null;
};

export type Directory = { path: string; parent: string | null; is_repo: boolean; dirs: { name: string; is_repo: boolean }[] };

export type Refs = { default: string; refs: string[] };

export type ViewEntry = { group: string; name: string; path: string; scope: "project" | "global" };
export type ViewFile = { path: string; scope: string; frontmatter: Record<string, string>; body: string };

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? res.statusText);
  return res.status === 204 || res.headers.get("content-length") === "0" ? (undefined as T) : res.json();
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const contentUrl = (worktreeId: number, path: string) => `/api/worktrees/${worktreeId}/content?${q({ path })}`;

export const api = {
  projects: () => request<Project[]>("GET", "/api/projects"),
  addProject: (p: { name: string; root_path: string }) => request<Project>("POST", "/api/projects", p),
  removeProject: (id: number) => request<void>("DELETE", `/api/projects/${id}`),
  directory: (path: string) => request<Directory>("GET", `/api/fs?${q({ path })}`),
  refs: (projectId: number) => request<Refs>("GET", `/api/projects/${projectId}/refs`),
  views: (projectId: number) => request<ViewEntry[]>("GET", `/api/projects/${projectId}/views`),
  viewFile: (projectId: number, path: string, scope: string) => request<ViewFile>("GET", `/api/projects/${projectId}/views/file?${q({ path, scope })}`),

  worktrees: () => request<Worktree[]>("GET", "/api/worktrees"),
  worktree: (id: number) => request<WorktreeDetail>("GET", `/api/worktrees/${id}`),
  addWorktree: (w: { project_id: number; branch: string; base_ref: string }) =>
    request<{ id: number }>("POST", "/api/worktrees", w),
  adoptWorktree: (body: { project_id: number; branch: string; path: string }) => request<{ id: number }>("POST", "/api/worktrees/adopt", body),
  archiveWorktree: (id: number) => request<void>("POST", `/api/worktrees/${id}/archive`),
  diff: (id: number, path: string) => request<{ diff: string }>("GET", `/api/worktrees/${id}/diff?${q({ path })}`),
  content: (id: number, path: string) => fetch(contentUrl(id, path)).then((r) => r.text()),

  sessions: (worktreeId: number) => request<Session[]>("GET", `/api/worktrees/${worktreeId}/sessions`),
  addSession: (worktreeId: number) => request<{ id: number }>("POST", `/api/worktrees/${worktreeId}/sessions`),
  markSeen: (worktreeId: number) => request<void>("POST", `/api/worktrees/${worktreeId}/seen`),
  closeSession: (id: number) => request<void>("DELETE", `/api/sessions/${id}`),

  comments: (worktreeId: number) => request<Comment[]>("GET", `/api/worktrees/${worktreeId}/comments`),
  addComment: (worktreeId: number, c: { path: string; block_id: string; quote: string; body: string }) =>
    request<Comment>("POST", `/api/worktrees/${worktreeId}/comments`, c),
  deleteComment: (id: number) => request<void>("DELETE", `/api/comments/${id}`),
  send: (worktreeId: number, s: { path?: string; session_id: number; extra: string }) =>
    request<void>("POST", `/api/worktrees/${worktreeId}/send`, s),
};
