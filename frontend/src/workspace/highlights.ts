/** Find the range of `quote` (whitespace-collapsed) inside a block element, or null if the text changed. */
export function findQuote(block: Element, quote: string): Range | null {
  let text = "";
  const map: [Text, number][] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
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
  if (start < 0 || !quote) return null;
  const range = document.createRange();
  range.setStart(...map[start]);
  const [endNode, endOffset] = map[start + quote.length - 1];
  range.setEnd(endNode, endOffset + 1);
  return range;
}

/** Paint ranges with a named CSS highlight (styled via ::highlight(name)); no DOM changes, so React is undisturbed. */
export function setHighlight(name: string, ranges: Range[]) {
  if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  else CSS.highlights.delete(name);
}
