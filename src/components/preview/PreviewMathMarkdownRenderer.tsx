import PreviewAutoMathMarkdownRenderer from "./PreviewAutoMathMarkdownRenderer";

interface PreviewMathMarkdownRendererProps {
  markdown: string;
}

export default function PreviewMathMarkdownRenderer({
  markdown,
}: PreviewMathMarkdownRendererProps) {
  return <PreviewAutoMathMarkdownRenderer markdown={markdown} />;
}
