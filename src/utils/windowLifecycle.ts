import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const NEUROPEN_WINDOW_LABELS = [
  "main",
  "quick-action",
  "preview",
  "settings",
  "recording-indicator",
  "screenshot-overlay",
] as const;

export const preventCloseDestroy = async (label: string) => {
  const win = await WebviewWindow.getByLabel(label);
  if (win) {
    await win.onCloseRequested(async (event) => {
      event.preventDefault();
      await win.hide();
    });
  }
};

export const isAnyNeuroPenWindowFocused = async () => {
  const results = await Promise.all(
    NEUROPEN_WINDOW_LABELS.map(async (label) => {
      const win = await WebviewWindow.getByLabel(label);
      return win ? win.isFocused() : false;
    })
  );
  return results.some(Boolean);
};

export const hideWindowByLabel = async (label: string) => {
  const win = await WebviewWindow.getByLabel(label);
  if (!win) return;
  await win.hide().catch(() => { });
};
