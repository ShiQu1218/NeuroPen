import ReactMarkdown from "react-markdown";
import { previewMarkdownComponents } from "./previewMarkdownComponents";

interface PreviewMarkdownRendererProps {
  markdown: string;
}

export default function PreviewMarkdownRenderer({
  markdown,
}: PreviewMarkdownRendererProps) {
  return <ReactMarkdown components={previewMarkdownComponents}>{markdown}</ReactMarkdown>;
}
