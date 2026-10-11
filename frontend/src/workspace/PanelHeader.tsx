import { ReactNode, useState } from "react";
import { FileStatus } from "../api";
import { Check, Copy } from "./icons";

export default function PanelHeader({ path, status, children }: { path: string; status?: FileStatus; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(path).then(() => (setCopied(true), window.setTimeout(() => setCopied(false), 1200)), () => {});
  return (
    <div className="phead grow-cell">
      <span className="mono path">{path}</span>
      <button className="iconbtn small" aria-label="Copy path" title={copied ? "Copied" : "Copy path"} onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </button>
      {status && <span className={`st st-${status}`}>{status}</span>}
      {children}
    </div>
  );
}
