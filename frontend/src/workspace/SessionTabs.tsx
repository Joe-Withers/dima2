import { Session } from "../api";
import { ArrowDown, ArrowUp, Plus } from "./icons";

type Props = {
  sessions: Session[];
  active: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onClose: (id: number) => void;
  onStep: (direction: -1 | 1) => void;
};

const dot = (s: Session) => (s.running ? "var(--accent-hover)" : s.alive ? "#5a5f66" : "var(--danger)");

export default function SessionTabs({ sessions, active, onSelect, onAdd, onClose, onStep }: Props) {
  return (
    <div className="tabbar">
      <div role="tablist" aria-label="Sessions" className="tabs">
        {sessions.map((s, i) => (
          <button key={s.id} role="tab" aria-selected={s.id === active} className={`tab${s.id === active ? " on" : ""}`} onClick={() => onSelect(s.id)}>
            <span className="dot" style={{ background: dot(s) }} />
            {i + 1} · {s.command || "bash"}
            <span className="tab-close" role="button" aria-label={`Close session ${i + 1}`} onClick={(e) => (e.stopPropagation(), onClose(s.id))}>×</span>
          </button>
        ))}
      </div>
      <button className="iconbtn" aria-label="New session" onClick={onAdd}><Plus /></button>
      <span className="grow" />
      <div className="layout-controls">
        <button className="iconbtn" aria-label="Give more room to files (Ctrl+Up)" onClick={() => onStep(-1)}><ArrowUp /></button>
        <span className="kbd">Ctrl ↑</span>
        <button className="iconbtn" aria-label="Give more room to terminal (Ctrl+Down)" onClick={() => onStep(1)}><ArrowDown /></button>
        <span className="kbd">Ctrl ↓</span>
      </div>
    </div>
  );
}
