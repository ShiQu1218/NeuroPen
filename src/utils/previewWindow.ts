import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { clampToMonitorBounds } from "./windowBounds";

export type PreviewSourceMode = "A" | "B1" | "B2" | "C";

export type PreviewSessionPayload =
  | {
    sessionType: "text";
    sourceMode: PreviewSourceMode;
    selectedText: string;
    instruction: string;
    startLoading?: boolean;
  }
  | {
    sessionType: "screenshot";
    sourceMode: "C";
    selectedText: string;
    instruction: string;
  };

interface ShowPreviewWindowOptions {
  focusable?: boolean;
  focus?: boolean;
  size?: {
    width: number;
    height: number;
  };
  position?: {
    x: number;
    y: number;
  };
}

export const emitPreviewSession = async (payload: PreviewSessionPayload) => {
  await emit("neuropen://preview-session", payload);
};

export const emitPreviewStaticOutput = async (text: string) => {
  await emit("neuropen://preview-static-output", { text });
};

export const openAssistantDialog = async () => {
  const previewWin = await WebviewWindow.getByLabel("preview");
  if (!previewWin) return null;

  const isVisible = await previewWin.isVisible().catch(() => false);
  if (!isVisible) {
    await emitPreviewSession({
      sessionType: "text",
      sourceMode: "C",
      selectedText: "",
      instruction: "",
      startLoading: false,
    });
  }

  await showPreviewWindow({ focusable: true, focus: true });
  await emit("neuropen://preview-focus-input");
  return previewWin;
};

export const showPreviewWindow = async (options: ShowPreviewWindowOptions = {}) => {
  const previewWin = await WebviewWindow.getByLabel("preview");
  if (!previewWin) return null;

  if (typeof options.focusable === "boolean") {
    await previewWin.setFocusable(options.focusable).catch(() => { });
  }

  if (options.size) {
    await previewWin.setSize(new LogicalSize(options.size.width, options.size.height));
  }

  if (options.position) {
    const previewSize = await previewWin.outerSize();
    const width = previewSize.width || options.size?.width || 0;
    const height = previewSize.height || options.size?.height || 0;
    const clamped = await clampToMonitorBounds(
      options.position.x,
      options.position.y,
      width,
      height
    );
    await previewWin.setPosition(new PhysicalPosition(clamped.x, clamped.y));
  }

  await previewWin.show();

  if (options.focus) {
    await previewWin.setFocus().catch(() => { });
  }

  return previewWin;
};
