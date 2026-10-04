const PALETTE = ["#6CA6E8", "#B38BE0", "#5FBF8F", "#E8A33D", "#E87C8C", "#5FC4C4"];

function djb2(s: string) {
  let h = 5381;
  for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h;
}

export const projectColor = (name: string) => PALETTE[djb2(name) % PALETTE.length];
