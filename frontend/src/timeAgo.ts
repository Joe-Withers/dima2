const UNITS: [number, string][] = [[86400, "d"], [3600, "h"], [60, "min"]];

export function timeAgo(unixSeconds: number, now = Date.now() / 1000) {
  const diff = now - unixSeconds;
  if (diff < 60) return "just now";
  const [size, unit] = UNITS.find(([size]) => diff >= size)!;
  return `${Math.floor(diff / size)} ${unit} ago`;
}
