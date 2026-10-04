import { useEffect, useId, useState } from "react";

export default function Mermaid({ chart }: { chart: string }) {
  const id = "mermaid-" + useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
      try {
        const result = await mermaid.render(id, chart);
        if (!cancelled) (setSvg(result.svg), setError(undefined));
      } catch (e) {
        document.getElementById("d" + id)?.remove(); // mermaid leaves a stray error node behind
        if (!cancelled) setError(String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) return <pre className="mermaid-error">{chart}</pre>;
  return <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg ?? "" }} />;
}
