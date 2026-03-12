import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

interface PreviewMathMarkdownRendererProps {
  markdown: string;
}

export default function PreviewMathMarkdownRenderer({
  markdown,
}: PreviewMathMarkdownRendererProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {markdown}
    </ReactMarkdown>
  );
}
