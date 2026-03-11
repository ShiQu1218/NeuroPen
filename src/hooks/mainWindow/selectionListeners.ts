import { emit } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { mainWindowService } from "../../services/mainWindowService";
import { useAppStore } from "../../store/useAppStore";
import { buildSelectionFingerprint } from "../../utils/appText";
import { clampToMonitorBounds } from "../../utils/windowBounds";
import { hideWindowByLabel, isAnyNeuroPenWindowFocused } from "../../utils/windowLifecycle";
import type { SafeRegister, SelectionListenerState, SelectionSnapshot } from "./listenerTypes";

interface RegisterSelectionListenersParams {
  safeRegister: SafeRegister;
  selectionState: SelectionListenerState;
}

export async function registerSelectionListeners({
  safeRegister,
  selectionState,
}: RegisterSelectionListenersParams) {
  const clearQaHideTimer = () => {
    if (selectionState.qaHideTimer) {
      clearTimeout(selectionState.qaHideTimer);
      selectionState.qaHideTimer = null;
    }
  };

  const clearQaResyncTimer = () => {
    if (selectionState.qaResyncTimer) {
      clearTimeout(selectionState.qaResyncTimer);
      selectionState.qaResyncTimer = null;
    }
  };

  const scheduleQaResync = (delayMs: number) => {
    clearQaResyncTimer();
    selectionState.qaResyncTimer = setTimeout(() => {
      selectionState.qaResyncTimer = null;
      void syncQuickAction(selectionState.lastSelectionSnapshot);
    }, Math.max(0, delayMs));
  };

  const syncQuickAction = async (snapshot: SelectionSnapshot | null) => {
    const store = useAppStore.getState();
    const qaWin = await WebviewWindow.getByLabel("quick-action");
    if (!qaWin) return;

    const now = Date.now();
    if (selectionState.suppressedSelectionFingerprint && now >= selectionState.selectionWatchSuppressedUntil) {
      selectionState.suppressedSelectionFingerprint = "";
    }

    if (now < selectionState.selectionWatchSuppressedUntil) {
      if (snapshot?.hasSelection) {
        scheduleQaResync(selectionState.selectionWatchSuppressedUntil - now + 24);
      }
      return;
    }

    if (!store.selectionEnabled) {
      selectionState.lastSelectionFingerprint = "";
      selectionState.suppressedSelectionFingerprint = "";
      selectionState.lastSelectionSnapshot = null;
      clearQaHideTimer();
      clearQaResyncTimer();
      await hideWindowByLabel("quick-action");
      return;
    }

    // Don't show Quick Action Icon while recording.
    if (store.isRecording) return;
    // Freeze watcher-driven UI updates while quick-action is interacting.
    if (selectionState.qaInteracting) {
      if (snapshot?.hasSelection) {
        scheduleQaResync(120);
      }
      return;
    }
    // Ignore internal selections from NeuroPen windows (preview/quick-action/etc).
    if (await isAnyNeuroPenWindowFocused()) {
      if (snapshot?.hasSelection) {
        scheduleQaResync(120);
      }
      return;
    }

    if (snapshot?.hasSelection) {
      clearQaHideTimer();
      const selectionText = (snapshot.text ?? "").trim();
      if (!selectionText) {
        store.setSelectedText("");
        selectionState.lastSelectionFingerprint = "";
        selectionState.suppressedSelectionFingerprint = "";
        selectionState.lastSelectionSnapshot = null;
        await qaWin.hide();
        return;
      }
      store.setSelectedText(selectionText);
      await emit("neuropen://stable-selection", { text: selectionText });

      // Position QA icon below selection end (fallback to cursor).
      const x = typeof snapshot.anchorX === "number" ? snapshot.anchorX : snapshot.cursorX;
      const y = typeof snapshot.anchorY === "number" ? snapshot.anchorY : snapshot.cursorY;
      const currentFingerprint = buildSelectionFingerprint(selectionText, snapshot.anchorX, snapshot.anchorY);
      if (selectionState.suppressedSelectionFingerprint) {
        if (currentFingerprint === selectionState.suppressedSelectionFingerprint) {
          selectionState.lastSelectionFingerprint = currentFingerprint;
          return;
        }
        selectionState.suppressedSelectionFingerprint = "";
      }
      // Lock target window + cache clipboard once per unique selection.
      if (currentFingerprint !== selectionState.lastSelectionFingerprint) {
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
      // Keep the editor active so its native text selection remains usable
      // even after the non-focusable quick-action window is shown.
      await mainWindowService.restoreFocus().catch((err) => {
        console.warn("[App] restore_focus after qa show failed:", err);
        return false;
      });
      return;
    }

    selectionState.lastSelectionFingerprint = "";
    selectionState.suppressedSelectionFingerprint = "";
    clearQaHideTimer();
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
  };

  await safeRegister<{ active: boolean }>(
    "neuropen://qa-interacting",
    async (event) => {
      selectionState.qaInteracting = !!event.payload.active;
      if (selectionState.qaInteracting) {
        clearQaHideTimer();
        clearQaResyncTimer();
      }
      if (Date.now() < selectionState.selectionWatchSuppressedUntil) {
        if (!selectionState.qaInteracting && selectionState.lastSelectionSnapshot?.hasSelection) {
          scheduleQaResync(selectionState.selectionWatchSuppressedUntil - Date.now() + 24);
        }
        return;
      }
      if (!selectionState.qaInteracting) {
        await syncQuickAction(selectionState.lastSelectionSnapshot);
      }
    },
  );

  await safeRegister<{ cooldownMs?: number }>("neuropen://qa-suppress-current-selection", async (event) => {
    selectionState.suppressedSelectionFingerprint = selectionState.lastSelectionFingerprint;
    selectionState.selectionWatchSuppressedUntil = Date.now() + Math.max(300, event.payload.cooldownMs ?? 1200);
    await hideWindowByLabel("quick-action");
    if (selectionState.lastSelectionSnapshot?.hasSelection) {
      scheduleQaResync(selectionState.selectionWatchSuppressedUntil - Date.now() + 24);
    }
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
      clearQaResyncTimer();
      selectionState.lastSelectionSnapshot = {
        hasSelection: event.payload.has_selection,
        text: event.payload.text,
        cursorX: event.payload.cursor_x,
        cursorY: event.payload.cursor_y,
        anchorX: event.payload.anchor_x,
        anchorY: event.payload.anchor_y,
      };
      await syncQuickAction(selectionState.lastSelectionSnapshot);
    },
  );
}
