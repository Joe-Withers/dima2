import { ReactNode } from "react";
import { FileStatus } from "../api";

export default function PanelHeader({ path, status, children }: { path: string; status: FileStatus; children?: ReactNode }) {
  return (
    <div className="phead grow-cell">
      <span className="mono path">{path}</span>
      <span className={`st st-${status}`}>{status}</span>
      {children}
    </div>
  );
}
