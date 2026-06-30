import { emit } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { mainWindowService } from "../../services/mainWindowService";
import { useAppStore, type QuickActionCommand } from "../../store/useAppStore";
import { buildSelectionFingerprint } from "../../utils/appText";
import { clampToMonitorBounds } from "../../utils/windowBounds";
import { hideWindowByLabel, isAnyNeuroPenWindowFocused } from "../../utils/windowLifecycle";
import type { SafeRegister, SelectionListenerState, SelectionSnapshot } from "./listenerTypes";

interface RegisterSelectionListenersParams {
  safeRegister: SafeRegister;
  selectionState: SelectionListenerState;
}

function normalizeSelectionText(text: string | null | undefined) {
  return (text ?? "").trim();
}

async function isCursorInsideWindow(label: "quick-action" | "preview", x: number, y: number) {
  const win = await WebviewWindow.getByLabel(label);
  if (!win) {
    return false;
  }

  const isVisible = await win.isVisible().catch(() => false);
  if (!isVisible) {
    return false;
  }

  const [pos, size] = await Promise.all([
    win.outerPosition().catch(() => null),
    win.outerSize().catch(() => null),
  ]);

  if (!pos || !size || size.width <= 0 || size.height <= 0) {
    return false;
  }

  return (
    x >= pos.x &&
    x < pos.x + size.width &&
    y >= pos.y &&
    y < pos.y + size.height
  );
}

async function shouldPreserveQuickActionAnchor(
  selectionState: SelectionListenerState,
  snapshot: SelectionSnapshot,
) {
  const anchorPinned = Date.now() < selectionState.selectionAnchorPinUntil;
  const cursorInsideNeuroPenSurface = await Promise.all([
    isCursorInsideWindow("quick-action", snapshot.cursorX, snapshot.cursorY),
    isCursorInsideWindow("preview", snapshot.cursorX, snapshot.cursorY),
  ]).then((results) => results.some(Boolean));

  if (
    (!selectionState.qaInteracting && !anchorPinned && !cursorInsideNeuroPenSurface) ||
    !snapshot.hasSelection
  ) {
    return false;
  }

  const lastSnapshot = selectionState.lastSelectionSnapshot;
  if (!lastSnapshot?.hasSelection) {
    return false;
  }

  const incomingText = normalizeSelectionText(snapshot.text);
  const previousText = normalizeSelectionText(lastSnapshot.text);

  if (!incomingText || !previousText) {
    return false;
  }

  // Clicking a quick-action button emits a fresh mouse-release selection event
  // whose cursor coordinates point at the popup instead of the original text.
  // Keep the last stable selection anchor so suppress/resync continues to track
  // the selected text rather than the popup click position.
  return incomingText === previousText;
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
    const previewWin = await WebviewWindow.getByLabel("preview");

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

    const previewVisible = previewWin
      ? await previewWin.isVisible().catch(() => false)
      : false;
    if (previewVisible) {
      clearQaHideTimer();
      await qaWin.hide().catch(() => { });
      if (snapshot?.hasSelection) {
        scheduleQaResync(240);
      }
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
      if (currentFingerprint === selectionState.lastSelectionFingerprint) {
        return;
      }
      // Lock target window (without touching clipboard) once per unique selection.
      try {
        await mainWindowService.lockWindow();
        selectionState.lastSelectionFingerprint = currentFingerprint;
      } catch (err) {
        console.warn("[App] lock_window failed:", err);
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

    const clearSelectionAndHideQuickAction = async () => {
      selectionState.lastSelectionFingerprint = "";
      selectionState.suppressedSelectionFingerprint = "";
      selectionState.lastSelectionSnapshot = null;
      useAppStore.getState().setSelectedText("");
      await qaWin.hide().catch(() => { });
    };

    if (snapshot?.suppressedByPlainClick || snapshot?.hideImmediately) {
      clearQaHideTimer();
      await clearSelectionAndHideQuickAction();
      return;
    }

    clearQaHideTimer();
    selectionState.qaHideTimer = setTimeout(() => {
      selectionState.qaHideTimer = null;
      if (selectionState.qaInteracting) return;
      void (async () => {
        const sel = await mainWindowService.getSelection().catch(() => ({ has_selection: false }));
        if (!sel.has_selection) {
          await clearSelectionAndHideQuickAction();
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

  await safeRegister<{ cooldownMs?: number }>(
    "neuropen://qa-pin-selection-anchor",
    async (event) => {
      selectionState.selectionAnchorPinUntil =
        Date.now() + Math.max(300, event.payload.cooldownMs ?? 1200);
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
    quickActionCommands?: QuickActionCommand[];
  }>(
    "neuropen://settings-saved",
    async (event) => {
      if (!event.payload.quickActionCommands) {
        return;
      }
      clearQaHideTimer();
      clearQaResyncTimer();
      selectionState.lastSelectionFingerprint = "";
      selectionState.suppressedSelectionFingerprint = "";
      selectionState.selectionWatchSuppressedUntil = 0;
    },
  );

  await safeRegister<{
    has_selection: boolean;
    text: string | null;
    cursor_x: number;
    cursor_y: number;
    anchor_x?: number | null;
    anchor_y?: number | null;
    release_gesture?: "plain-click" | "drag-select" | "double-click" | null;
    suppressed_by_plain_click?: boolean;
    hide_immediately?: boolean;
    selection_source?: "uia" | "uia-stale" | "clipboard" | null;
  }>(
    "neuropen://selection-changed",
    async (event) => {
      clearQaResyncTimer();
      const nextSnapshot: SelectionSnapshot = {
        hasSelection: event.payload.has_selection,
        text: event.payload.text,
        cursorX: event.payload.cursor_x,
        cursorY: event.payload.cursor_y,
        anchorX: event.payload.anchor_x,
        anchorY: event.payload.anchor_y,
        suppressedByPlainClick: event.payload.suppressed_by_plain_click,
        hideImmediately: event.payload.hide_immediately,
        selectionSource: event.payload.selection_source,
      };
      if (!(await shouldPreserveQuickActionAnchor(selectionState, nextSnapshot))) {
        selectionState.lastSelectionSnapshot = nextSnapshot;
      }
      await syncQuickAction(selectionState.lastSelectionSnapshot);
    },
  );
}
