import type { Element, Nodes, Root } from "hast";

const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "blockquote", "table"]);

function textOf(node: Nodes): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(textOf).join("") : "";
}

function hash(s: string) {
  let h = 5381;
  for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** rehype plugin: stamp each block with an id derived from its text, so comments survive edits elsewhere in the file. */
export default function rehypeBlockIds() {
  return (tree: Root) => {
    const seen = new Map<string, number>();
    const walk = (node: Nodes) => {
      if (node.type === "element" && BLOCKS.has(node.tagName)) {
        const base = hash(`${node.tagName}:${textOf(node).replace(/\s+/g, " ").trim()}`);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        (node as Element).properties.dataBlockId = n === 1 ? base : `${base}-${n}`;
      }
      if ("children" in node) node.children.forEach(walk);
    };
    walk(tree);
  };
}
