import { useEffect, useState } from "react";

export type Mode = "balanced" | "top" | "bottom";
type Layout = { mode: Mode; ratio: number };

const KEY = "dima2.layout";
const DEFAULT: Layout = { mode: "balanced", ratio: 0.57 };
const ORDER: Mode[] = ["top", "balanced", "bottom"]; // Ctrl+Up moves towards "top", Ctrl+Down towards "bottom"

function load(): Layout {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT;
  }
}

/** Global (not per-worktree) split between the files region and the terminal, remembered across reloads. */
export function useLayout() {
  const [layout, setLayout] = useState(load);
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(layout)), [layout]);

  const step = (direction: -1 | 1) =>
    setLayout((l) => ({ ...l, mode: ORDER[Math.min(2, Math.max(0, ORDER.indexOf(l.mode) + direction))] }));

  // Handled on window so it also works while the terminal has focus (the terminal doesn't forward these keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      step(e.key === "ArrowUp" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return {
    mode: layout.mode,
    ratio: layout.ratio,
    step,
    restore: () => setLayout((l) => ({ ...l, mode: "balanced" })),
    setRatio: (ratio: number) => setLayout({ mode: "balanced", ratio: Math.min(0.9, Math.max(0.1, ratio)) }),
  };
}
