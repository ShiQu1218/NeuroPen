import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PreviewGfmMarkdownRendererProps {
  markdown: string;
}

export default function PreviewGfmMarkdownRenderer({
  markdown,
}: PreviewGfmMarkdownRendererProps) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>;
}
