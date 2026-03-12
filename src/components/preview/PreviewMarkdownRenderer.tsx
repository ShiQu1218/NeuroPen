import ReactMarkdown from "react-markdown";

interface PreviewMarkdownRendererProps {
  markdown: string;
}

export default function PreviewMarkdownRenderer({
  markdown,
}: PreviewMarkdownRendererProps) {
  return <ReactMarkdown>{markdown}</ReactMarkdown>;
}
