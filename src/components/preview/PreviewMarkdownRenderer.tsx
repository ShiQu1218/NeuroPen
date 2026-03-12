import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PreviewMarkdownRendererProps {
  markdown: string;
}

export default function PreviewMarkdownRenderer({
  markdown,
}: PreviewMarkdownRendererProps) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>;
}
