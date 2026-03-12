import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

interface PreviewMarkdownRendererProps {
  markdown: string;
}

export default function PreviewMarkdownRenderer({
  markdown,
}: PreviewMarkdownRendererProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
      {markdown}
    </ReactMarkdown>
  );
}
