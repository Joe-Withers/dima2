const svg = (path: string, size = 16, width = 2) => () => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

export const Plus = svg("M12 5v14M5 12h14");
export const ArrowUp = svg("M6 14l6-6 6 6");
export const ArrowDown = svg("M6 10l6 6 6-6");
export const Back = svg("M15 6l-6 6 6 6");
export const Check = svg("M5 12.5l4.5 4.5L19 7.5");
export const Send = svg("M4 12l16-8-6 16-2.5-6.5z", 15);
export const Close = svg("M6 6l12 12M18 6L6 18", 18);
