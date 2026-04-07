import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { previewMarkdownComponents } from "./previewMarkdownComponents";

interface PreviewGfmMarkdownRendererProps {
  markdown: string;
}

export default function PreviewGfmMarkdownRenderer({
  markdown,
}: PreviewGfmMarkdownRendererProps) {
  return (
    <ReactMarkdown
      components={previewMarkdownComponents}
      remarkPlugins={[remarkGfm]}
    >
      {markdown}
    </ReactMarkdown>
  );
}
