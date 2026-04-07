import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { previewMarkdownComponents } from "./previewMarkdownComponents";

interface PreviewMathGfmMarkdownRendererProps {
  markdown: string;
}

export default function PreviewMathGfmMarkdownRenderer({
  markdown,
}: PreviewMathGfmMarkdownRendererProps) {
  return (
    <ReactMarkdown
      components={previewMarkdownComponents}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {markdown}
    </ReactMarkdown>
  );
}
