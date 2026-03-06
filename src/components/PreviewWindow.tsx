import PreviewWindowBody from "./preview/PreviewWindowBody";
import { usePreviewWindowController } from "../hooks/usePreviewWindowController";

export default function PreviewWindow() {
  const controller = usePreviewWindowController();
  return <PreviewWindowBody {...controller} />;
}
