import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { previewMarkdownComponents } from "./previewMarkdownComponents";

interface PreviewMathMarkdownRendererProps {
  markdown: string;
}

export default function PreviewMathMarkdownRenderer({
  markdown,
}: PreviewMathMarkdownRendererProps) {
  return (
    <ReactMarkdown
      components={previewMarkdownComponents}
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {markdown}
    </ReactMarkdown>
  );
}
