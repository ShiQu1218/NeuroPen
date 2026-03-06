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
  await emit("talkflow://preview-session", payload);
};

export const emitPreviewStaticOutput = async (text: string) => {
  await emit("talkflow://preview-static-output", { text });
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
