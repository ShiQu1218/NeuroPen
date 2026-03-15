import { availableMonitors, currentMonitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, emitTo } from "@tauri-apps/api/event";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { mainWindowService } from "../../services/mainWindowService";
import { useAppStore } from "../../store/useAppStore";
import { cropScreenshotBase64 } from "../../utils/screenshotCrop";
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
  let cachedSnapshotBase64 = "";
  let cachedVirtualBounds:
    | {
        x: number;
        y: number;
        w: number;
        h: number;
      }
    | null = null;

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
      const monitors = await availableMonitors().catch(() => []);
      const fallbackMonitor = await currentMonitor().catch(() => null);
      const virtualBounds = (
        monitors.length > 0 ? monitors : fallbackMonitor ? [fallbackMonitor] : []
      ).reduce(
        (bounds, monitor) => ({
          x: Math.min(bounds.x, monitor.position.x),
          y: Math.min(bounds.y, monitor.position.y),
          right: Math.max(bounds.right, monitor.position.x + monitor.size.width),
          bottom: Math.max(bounds.bottom, monitor.position.y + monitor.size.height),
        }),
        {
          x: Number.POSITIVE_INFINITY,
          y: Number.POSITIVE_INFINITY,
          right: Number.NEGATIVE_INFINITY,
          bottom: Number.NEGATIVE_INFINITY,
        },
      );
      if (
        overlayWin &&
        Number.isFinite(virtualBounds.x) &&
        Number.isFinite(virtualBounds.y) &&
        Number.isFinite(virtualBounds.right) &&
        Number.isFinite(virtualBounds.bottom)
      ) {
        const captureRegion = {
          x: virtualBounds.x,
          y: virtualBounds.y,
          w: virtualBounds.right - virtualBounds.x,
          h: virtualBounds.bottom - virtualBounds.y,
        };
        let snapshotBase64 = "";
        try {
          // Capture the whole virtual desktop so a single overlay can span every monitor
          // and still show the correct stitched screenshot behind the selection box.
          const desktopShot = await mainWindowService.takeScreenshotRegion(captureRegion);
          snapshotBase64 = desktopShot.base64Png ?? desktopShot.base64_png ?? "";
        } catch (err) {
          console.warn("[App] virtual desktop snapshot for overlay failed:", err);
        }
        cachedSnapshotBase64 = snapshotBase64;
        cachedVirtualBounds = captureRegion;
        await overlayWin.setSize(new PhysicalSize(captureRegion.w, captureRegion.h));
        await overlayWin.setPosition(
          new PhysicalPosition(captureRegion.x, captureRegion.y),
        );
        await overlayWin.show();
        await overlayWin.setFocus();
        await emitTo("screenshot-overlay", "neuropen://screenshot-start", {
          snapshotBase64,
          virtualBounds: captureRegion,
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
      const snapshotBase64 = cachedSnapshotBase64;
      const snapshotBounds = cachedVirtualBounds;
      cachedSnapshotBase64 = "";
      cachedVirtualBounds = null;
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
      if (
        store.llmProvider !== "ollama" &&
        store.llmProvider !== "llamaCpp" &&
        store.llmProvider !== "lmStudio"
      ) {
        const hasLlmKey = await mainWindowService.hasLlmApiKey().catch(() => false);
        if (!hasLlmKey) {
          setSttError(t("error.llmApiKeyRequired"));
          setStatusMsg(t("status.screenshotNeedsLlmApiKey"));
          return;
        }
      }
      setStatusMsg(t("status.screenshotCapturing"));
      try {
        let imageBase64 = "";
        if (snapshotBase64 && snapshotBounds) {
          try {
            imageBase64 = await cropScreenshotBase64(snapshotBase64, snapshotBounds, {
              x: event.payload.x,
              y: event.payload.y,
              w: event.payload.w,
              h: event.payload.h,
            });
          } catch (cropErr) {
            console.warn("[App] cached screenshot crop failed, falling back to live capture:", cropErr);
          }
        }
        if (!imageBase64) {
          const shot = await mainWindowService.takeScreenshotRegion({
            x: event.payload.x,
            y: event.payload.y,
            w: event.payload.w,
            h: event.payload.h,
          });
          imageBase64 = shot.base64Png ?? shot.base64_png ?? "";
        }
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
