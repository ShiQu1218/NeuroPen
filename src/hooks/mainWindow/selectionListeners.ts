import { emit } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { mainWindowService } from "../../services/mainWindowService";
import { useAppStore } from "../../store/useAppStore";
import { buildSelectionFingerprint } from "../../utils/appText";
import { clampToMonitorBounds } from "../../utils/windowBounds";
import { hideWindowByLabel, isAnyNeuroPenWindowFocused } from "../../utils/windowLifecycle";
import type { SafeRegister, SelectionListenerState } from "./listenerTypes";

interface RegisterSelectionListenersParams {
  safeRegister: SafeRegister;
  selectionState: SelectionListenerState;
}

export async function registerSelectionListeners({
  safeRegister,
  selectionState,
}: RegisterSelectionListenersParams) {
  await safeRegister<{ active: boolean }>(
    "neuropen://qa-interacting",
    async (event) => {
      selectionState.qaInteracting = !!event.payload.active;
      if (selectionState.qaInteracting && selectionState.qaHideTimer) {
        clearTimeout(selectionState.qaHideTimer);
        selectionState.qaHideTimer = null;
      }
      if (Date.now() < selectionState.selectionWatchSuppressedUntil) {
        return;
      }
      if (!selectionState.qaInteracting) {
        const sel = await mainWindowService.getSelection();
        if (!sel.has_selection) {
          selectionState.lastSelectionFingerprint = "";
          selectionState.suppressedSelectionFingerprint = "";
          await hideWindowByLabel("quick-action");
        }
      }
    },
  );

  await safeRegister<{ cooldownMs?: number }>("neuropen://qa-suppress-current-selection", async (event) => {
    selectionState.suppressedSelectionFingerprint = selectionState.lastSelectionFingerprint;
    selectionState.selectionWatchSuppressedUntil = Date.now() + Math.max(300, event.payload.cooldownMs ?? 1200);
    await hideWindowByLabel("quick-action");
  });

  await safeRegister<{
    has_selection: boolean;
    text: string | null;
    cursor_x: number;
    cursor_y: number;
    anchor_x?: number | null;
    anchor_y?: number | null;
  }>(
    "neuropen://selection-changed",
    async (event) => {
      const { has_selection, text, cursor_x, cursor_y, anchor_x, anchor_y } = event.payload;
      const store = useAppStore.getState();
      if (Date.now() < selectionState.selectionWatchSuppressedUntil) {
        return;
      }
      if (!store.selectionEnabled) {
        selectionState.lastSelectionFingerprint = "";
        selectionState.suppressedSelectionFingerprint = "";
        await hideWindowByLabel("quick-action");
        return;
      }

      // Don't show Quick Action Icon while recording
      if (store.isRecording) return;
      // Freeze watcher-driven UI updates while quick-action is interacting.
      if (selectionState.qaInteracting) return;
      // Ignore internal selections from NeuroPen windows (preview/quick-action/etc).
      if (await isAnyNeuroPenWindowFocused()) return;

      const qaWin = await WebviewWindow.getByLabel("quick-action");
      if (!qaWin) return;

      if (has_selection) {
        if (selectionState.qaHideTimer) {
          clearTimeout(selectionState.qaHideTimer);
          selectionState.qaHideTimer = null;
        }
        const selectionText = (text ?? "").trim();
        if (!selectionText) {
          store.setSelectedText("");
          selectionState.lastSelectionFingerprint = "";
          selectionState.suppressedSelectionFingerprint = "";
          await qaWin.hide();
          return;
        }
        store.setSelectedText(selectionText);
        await emit("neuropen://stable-selection", { text: selectionText });

        // Position QA icon below selection end (fallback to cursor).
        const x = typeof anchor_x === "number" ? anchor_x : cursor_x;
        const y = typeof anchor_y === "number" ? anchor_y : cursor_y;
        const currentFingerprint = buildSelectionFingerprint(selectionText, anchor_x, anchor_y);
        if (selectionState.suppressedSelectionFingerprint) {
          if (currentFingerprint === selectionState.suppressedSelectionFingerprint) {
            selectionState.lastSelectionFingerprint = currentFingerprint;
            return;
          }
          selectionState.suppressedSelectionFingerprint = "";
        }
        // Lock target window + cache clipboard once per unique selection.
        if (currentFingerprint !== selectionState.lastSelectionFingerprint) {
          // Auto-close old Preview Window only when the selection actually changed.
          const previewWin = await WebviewWindow.getByLabel("preview");
          if (previewWin) {
            const isVisible = await previewWin.isVisible();
            if (isVisible) {
              await previewWin.hide();
              const state = useAppStore.getState();
              state.setLlmOutput("");
              state.setIsLlmLoading(false);
              state.setLlmError("");
            }
          }
          try {
            await mainWindowService.triggerHotkey();
            selectionState.lastSelectionFingerprint = currentFingerprint;
          } catch (err) {
            console.warn("[App] trigger_hotkey failed:", err);
          }
        }
        await qaWin.setSize(new LogicalSize(40, 40));
        const qaSize = await qaWin.outerSize();
        const clampedQaPos = await clampToMonitorBounds(
          x + 8,
          y + 8,
          qaSize.width,
          qaSize.height,
        );
        await qaWin.setPosition(new PhysicalPosition(clampedQaPos.x, clampedQaPos.y));
        await qaWin.show();
        await emit("neuropen://qa-show");
      } else {
        selectionState.lastSelectionFingerprint = "";
        selectionState.suppressedSelectionFingerprint = "";
        if (selectionState.qaInteracting) return;
        if (selectionState.qaHideTimer) {
          clearTimeout(selectionState.qaHideTimer);
        }
        selectionState.qaHideTimer = setTimeout(() => {
          selectionState.qaHideTimer = null;
          if (selectionState.qaInteracting) return;
          void (async () => {
            const sel = await mainWindowService.getSelection().catch(() => ({ has_selection: false }));
            if (!sel.has_selection) {
              await qaWin.hide().catch(() => { });
            }
          })();
        }, 180);
      }
    },
  );
}
