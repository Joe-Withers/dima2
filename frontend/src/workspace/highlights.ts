const blockOf = (node: Node) => node.parentElement?.closest("[data-block-id]");

/**
 * Find the range of `quote` (whitespace-collapsed) starting in `block`. The quote may run on into following
 * blocks, so the scan continues to the end of `root`. Returns null if the text no longer exists.
 */
export function findQuote(root: Element, block: Element, quote: string): Range | null {
  if (!quote) return null;
  let text = "";
  const map: ([Text, number] | null)[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node && !block.contains(node)) node = walker.nextNode() as Text | null;
  for (let previous: Element | null | undefined; node; node = walker.nextNode() as Text | null) {
    const current = blockOf(node);
    if (previous && current !== previous && !text.endsWith(" ")) (text += " ", map.push(null)); // block boundary reads as a space
    previous = current;
    for (let i = 0; i < node.data.length; i++) {
      let ch = node.data[i];
      if (/\s/.test(ch)) {
        if (!text || text.endsWith(" ")) continue;
        ch = " ";
      }
      text += ch;
      map.push([node, i]);
    }
  }
  const start = text.indexOf(quote);
  const first = map[start];
  const last = map[start + quote.length - 1];
  if (start < 0 || !first || !last) return null;
  const range = document.createRange();
  range.setStart(...first);
  range.setEnd(last[0], last[1] + 1);
  return range;
}

/** Paint ranges with a named CSS highlight (styled via ::highlight(name)); no DOM changes, so React is undisturbed. */
export function setHighlight(name: string, ranges: Range[]) {
  if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  else CSS.highlights.delete(name);
}
