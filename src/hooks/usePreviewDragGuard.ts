import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

interface UsePreviewDragGuardOptions {
  setPreviewFocusable: (focusable: boolean, focus?: boolean) => Promise<void>;
}

export function usePreviewDragGuard({ setPreviewFocusable }: UsePreviewDragGuardOptions) {
  const dragLockUntilRef = useRef(0);
  const dragResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDragInteractionLocked = useCallback(
    () => Date.now() < dragLockUntilRef.current,
    []
  );

  const swallowDragRelease = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!isDragInteractionLocked()) return;
    event.preventDefault();
    event.stopPropagation();
  }, [isDragInteractionLocked]);

  const handleStartDrag = useCallback(async () => {
    dragLockUntilRef.current = Date.now() + 1500;
    if (dragResetTimerRef.current) {
      clearTimeout(dragResetTimerRef.current);
      dragResetTimerRef.current = null;
    }
    try {
      await setPreviewFocusable(true, true);
      await getCurrentWindow().startDragging();
    } finally {
      dragLockUntilRef.current = Date.now() + 220;
      dragResetTimerRef.current = setTimeout(() => {
        dragResetTimerRef.current = null;
        if (Date.now() >= dragLockUntilRef.current) {
          void setPreviewFocusable(false);
        }
      }, 260);
    }
  }, [setPreviewFocusable]);

  useEffect(() => () => {
    if (dragResetTimerRef.current) {
      clearTimeout(dragResetTimerRef.current);
    }
  }, []);

  return {
    handleStartDrag,
    isDragInteractionLocked,
    swallowDragRelease,
  };
}
