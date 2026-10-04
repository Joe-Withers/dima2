import { isValidElement } from "react";
import ReactMarkdown, { Components, defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import rehypeBlockIds from "./blockIds";
import Mermaid from "./Mermaid";

type Props = {
  source: string;
  /** Maps a relative image path in the markdown to a URL. */
  resolveImage?: (src: string) => string;
};

const REMARK = [remarkGfm];
const REHYPE = [rehypeRaw, rehypeSanitize, rehypeBlockIds];

// Module-level so React sees the same component types on every render (a fresh `pre` would remount diagrams).
const COMPONENTS: Components = {
  pre({ node, children, ...props }) {
    const code = isValidElement<{ className?: string; children?: string }>(children) ? children.props : undefined;
    if (code?.className === "language-mermaid") {
      const blockId = (props as Record<string, string>)["data-block-id"];
      return <div data-block-id={blockId}><Mermaid chart={String(code.children)} /></div>;
    }
    return <pre {...props}>{children}</pre>;
  },
};

/** Rendered markdown. Embedded HTML is allowed but sanitized; mermaid blocks become diagrams. */
export default function Markdown({ source, resolveImage }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK}
      rehypePlugins={REHYPE}
      urlTransform={(url, key) => (key === "src" && resolveImage ? resolveImage(url) : defaultUrlTransform(url))}
      components={COMPONENTS}
    >
      {source}
    </ReactMarkdown>
  );
}
