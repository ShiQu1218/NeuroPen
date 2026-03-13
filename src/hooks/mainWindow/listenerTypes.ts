import type { TranslationKey } from "../../i18n";

export type SafeRegister = <T>(
  event: string,
  handler: (e: { payload: T }) => void | Promise<void>,
) => Promise<void>;

export type TranslateFn = (key: TranslationKey, params?: Record<string, string>) => string;
export type StatusSetter = (message: string) => void;
export type ErrorSetter = (message: string) => void;

export interface SelectionSnapshot {
  hasSelection: boolean;
  text: string | null;
  cursorX: number;
  cursorY: number;
  anchorX?: number | null;
  anchorY?: number | null;
}

export interface SelectionListenerState {
  qaInteracting: boolean;
  selectionAnchorPinUntil: number;
  lastSelectionFingerprint: string;
  suppressedSelectionFingerprint: string;
  selectionWatchSuppressedUntil: number;
  qaHideTimer: ReturnType<typeof setTimeout> | null;
  qaResyncTimer: ReturnType<typeof setTimeout> | null;
  lastSelectionSnapshot: SelectionSnapshot | null;
}
