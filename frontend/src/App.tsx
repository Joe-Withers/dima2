import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import Projects from "./pages/Projects";
import Views from "./pages/Views";
import Workspace from "./workspace/Workspace";
import Worktrees from "./pages/Worktrees";
import { useAttentionCount } from "./useWorktrees";

export default function App() {
  const attention = useAttentionCount();
  useEffect(() => {
    document.title = attention > 0 ? `(${attention}) dima2` : "dima2";
  }, [attention]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">dima2</span>
        <nav>
          <NavLink to="/worktrees">Worktrees</NavLink>
          <NavLink to="/views">Views</NavLink>
          <NavLink to="/projects">Projects</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/worktrees" element={<Worktrees />} />
        <Route path="/worktrees/:id" element={<Workspace />} />
        <Route path="/views" element={<Views />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="*" element={<Navigate to="/worktrees" replace />} />
      </Routes>
    </div>
  );
}
