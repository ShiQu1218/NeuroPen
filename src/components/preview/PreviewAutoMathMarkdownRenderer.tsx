import { useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";
import { normalizePreviewMathExpression } from "../../utils/appText";
import { previewMarkdownComponents } from "./previewMarkdownComponents";

const previewMathDelimiters = [
  { left: "$$", right: "$$", display: true },
  { left: "$", right: "$", display: false },
  { left: "\\(", right: "\\)", display: false },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\begin{equation}", right: "\\end{equation}", display: true },
  { left: "\\begin{align}", right: "\\end{align}", display: true },
  { left: "\\begin{alignat}", right: "\\end{alignat}", display: true },
  { left: "\\begin{gather}", right: "\\end{gather}", display: true },
  { left: "\\begin{CD}", right: "\\end{CD}", display: true },
] as const;

interface PreviewAutoMathMarkdownRendererProps {
  markdown: string;
  useGfm?: boolean;
}

export default function PreviewAutoMathMarkdownRenderer({
  markdown,
  useGfm = false,
}: PreviewAutoMathMarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    renderMathInElement(container, {
      delimiters: [...previewMathDelimiters],
      ignoredClasses: ["katex"],
      errorCallback: () => undefined,
      preProcess: normalizePreviewMathExpression,
    });
  }, [markdown, useGfm]);

  return (
    <div ref={containerRef}>
      <ReactMarkdown
        key={`${useGfm ? "gfm" : "md"}:${markdown}`}
        components={previewMarkdownComponents}
        remarkPlugins={useGfm ? [remarkGfm] : undefined}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
