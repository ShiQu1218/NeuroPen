import PreviewAutoMathMarkdownRenderer from "./PreviewAutoMathMarkdownRenderer";

interface PreviewMathGfmMarkdownRendererProps {
  markdown: string;
}

export default function PreviewMathGfmMarkdownRenderer({
  markdown,
}: PreviewMathGfmMarkdownRendererProps) {
  return <PreviewAutoMathMarkdownRenderer markdown={markdown} useGfm />;
}
