import { availableMonitors, currentMonitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, emitTo } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { mainWindowService } from "../../services/mainWindowService";
import { useAppStore } from "../../store/useAppStore";
import { emitPreviewSession, showPreviewWindow } from "../../utils/previewWindow";
import type { ErrorSetter, SafeRegister, StatusSetter, TranslateFn } from "./listenerTypes";

interface RegisterScreenshotListenersParams {
  safeRegister: SafeRegister;
  t: TranslateFn;
  setStatusMsg: StatusSetter;
  setSttError: ErrorSetter;
}

export async function registerScreenshotListeners({
  safeRegister,
  t,
  setStatusMsg,
  setSttError,
}: RegisterScreenshotListenersParams) {
  await safeRegister("hotkey://screenshot", async () => {
    const store = useAppStore.getState();
    if (store.isRecording) {
      return;
    }
    if (!store.screenshotEnabled) {
      setStatusMsg(t("status.screenshotFeatureDisabled"));
      setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 1500);
      return;
    }
    try {
      const overlayWin = await WebviewWindow.getByLabel("screenshot-overlay");
      const cursor = await mainWindowService.getCursorPosition().catch(() => null);
      const monitors = await availableMonitors().catch(() => []);
      const monitor =
        (cursor
          ? monitors.find(
              (candidate) =>
                cursor.x >= candidate.position.x &&
                cursor.x < candidate.position.x + candidate.size.width &&
                cursor.y >= candidate.position.y &&
                cursor.y < candidate.position.y + candidate.size.height,
            ) ?? null
          : null) ?? await currentMonitor();
      if (overlayWin && monitor) {
        let snapshotBase64 = "";
        try {
          const monitorShot = await mainWindowService.takeScreenshotRegion({
            x: monitor.position.x,
            y: monitor.position.y,
            w: monitor.size.width,
            h: monitor.size.height,
          });
          snapshotBase64 = monitorShot.base64Png ?? monitorShot.base64_png ?? "";
        } catch (err) {
          console.warn("[App] monitor snapshot for overlay failed:", err);
        }
        const scale = monitor.scaleFactor;
        // monitor.size returns physical pixels; LogicalSize needs logical pixels.
        await overlayWin.setSize(new LogicalSize(
          monitor.size.width / scale,
          monitor.size.height / scale,
        ));
        await overlayWin.setPosition(
          new PhysicalPosition(monitor.position.x, monitor.position.y),
        );
        await overlayWin.show();
        await overlayWin.setFocus();
        await emitTo("screenshot-overlay", "neuropen://screenshot-start", {
          snapshotBase64,
        });
        setStatusMsg(t("status.screenshotDragHint"));
      } else {
        setStatusMsg(t("status.screenshotUnavailable"));
      }
    } catch (err) {
      console.error("[App] screenshot overlay open failed:", err);
      setStatusMsg(t("status.screenshotOpenFailed"));
    }
  });

  await safeRegister<{ x: number; y: number; w: number; h: number; cancelled?: boolean }>(
    "neuropen://screenshot-region",
    async (event) => {
      const overlayWin = await WebviewWindow.getByLabel("screenshot-overlay");
      if (overlayWin) {
        await overlayWin.hide().catch(() => {});
      }
      const store = useAppStore.getState();
      if (event.payload.cancelled) {
        setStatusMsg(t("status.screenshotCancelled"));
        setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 1200);
        return;
      }
      if (store.incognito) {
        setStatusMsg(t("status.screenshotDisabledIncognito"));
        setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2000);
        return;
      }
      if (store.llmProvider !== "ollama") {
        const hasLlmKey = await mainWindowService.hasLlmApiKey().catch(() => false);
        if (!hasLlmKey) {
          setSttError(t("error.llmApiKeyRequired"));
          setStatusMsg(t("status.screenshotNeedsLlmApiKey"));
          return;
        }
      }
      setStatusMsg(t("status.screenshotCapturing"));
      try {
        const shot = await mainWindowService.takeScreenshotRegion({
          x: event.payload.x,
          y: event.payload.y,
          w: event.payload.w,
          h: event.payload.h,
        });
        const imageBase64 = shot.base64Png ?? shot.base64_png ?? "";
        if (!imageBase64) {
          setStatusMsg(t("status.screenshotNoImage"));
          return;
        }
        // NOTE: We must pass the image via a Tauri event because each window
        // has its own Zustand store instance — store state is not shared.
        store.setCurrentMode("C");
        store.setLlmOutput("");
        store.setIsLlmLoading(false);
        store.setLlmError("");
        store.setLastSelectedText("");
        store.setLastInstruction("");
        void mainWindowService.clearConversation();
        await emitPreviewSession({
          sessionType: "screenshot",
          sourceMode: "C",
          selectedText: "",
          instruction: "",
        });
        await showPreviewWindow({ focusable: true, focus: true });
        await emit("neuropen://screenshot-attached", { imageBase64 });
        setStatusMsg(t("status.screenshotAttachedAsk"));
      } catch (err) {
        console.error("[App] screenshot flow failed:", err);
        setStatusMsg(t("status.screenshotFailed"));
      }
    },
  );
}
