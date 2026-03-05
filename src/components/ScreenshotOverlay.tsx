import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { emitTo, listen, TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Point = { x: number; y: number };

export default function ScreenshotOverlay() {
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  const dragCurrentRef = useRef<Point | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const closingRef = useRef(false);

  const rect = useMemo(() => {
    if (!dragStart || !dragCurrent) return null;
    return {
      x: Math.min(dragStart.x, dragCurrent.x),
      y: Math.min(dragStart.y, dragCurrent.y),
      w: Math.abs(dragCurrent.x - dragStart.x),
      h: Math.abs(dragCurrent.y - dragStart.y),
    };
  }, [dragStart, dragCurrent]);

  const resetDrag = () => {
    activePointerIdRef.current = null;
    dragStartRef.current = null;
    dragCurrentRef.current = null;
    setDragStart(null);
    setDragCurrent(null);
  };

  const resetSession = () => {
    closingRef.current = false;
    resetDrag();
  };

  const ensureFocus = async () => {
    const win = getCurrentWindow();
    // Transparent windows on Windows are click-through by default.
    // Force the OS to deliver cursor events to this overlay.
    await win.setIgnoreCursorEvents(false).catch(() => { });
    await win.setFocus().catch(() => { });
    rootRef.current?.focus();
    setTimeout(() => rootRef.current?.focus(), 0);
  };

  const closeWithPayload = async (payload: {
    x: number;
    y: number;
    w: number;
    h: number;
    cancelled: boolean;
  }) => {
    if (closingRef.current) return;
    closingRef.current = true;

    try {
      await getCurrentWindow().hide().catch(() => { });
      await emitTo("main", "talkflow://screenshot-region", payload);
    } finally {
      // Allow retry if close/emit path fails for any reason.
      closingRef.current = false;
    }
  };

  const cancelSelection = async () => {
    resetDrag();
    await closeWithPayload({ x: 0, y: 0, w: 0, h: 0, cancelled: true });
  };

  const completeSelection = async () => {
    const start = dragStartRef.current;
    const current = dragCurrentRef.current;
    if (!start || !current) return;

    const nextRect = {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      w: Math.abs(current.x - start.x),
      h: Math.abs(current.y - start.y),
    };
    resetDrag();

    if (nextRect.w < 8 || nextRect.h < 8) {
      await closeWithPayload({ x: 0, y: 0, w: 0, h: 0, cancelled: true });
      return;
    }

    const winPos = await getCurrentWindow()
      .outerPosition()
      .catch(() => ({ x: 0, y: 0 }));
    await closeWithPayload({
      x: Math.round(winPos.x + nextRect.x),
      y: Math.round(winPos.y + nextRect.y),
      w: Math.round(nextRect.w),
      h: Math.round(nextRect.h),
      cancelled: false,
    });
  };

  const updateDragPoint = (x: number, y: number) => {
    if (!dragStartRef.current) return;
    const point = { x, y };
    dragCurrentRef.current = point;
    setDragCurrent(point);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      e.preventDefault();
      void cancelSelection();
      return;
    }
    if (e.button !== 0) return;
    void ensureFocus();
    const point = { x: e.clientX, y: e.clientY };
    activePointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = point;
    dragCurrentRef.current = point;
    setDragStart(point);
    setDragCurrent(point);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    updateDragPoint(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!dragStartRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    void completeSelection();
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    if (!dragStartRef.current) return;
    void cancelSelection();
  };

  useEffect(() => {
    let cancelled = false;
    let unlistenStart: (() => void) | null = null;
    let unlistenBlur: (() => void) | null = null;

    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!dragStartRef.current) return;
      void completeSelection();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void cancelSelection();
      }
    };

    void (async () => {
      unlistenStart = await listen("talkflow://screenshot-start", () => {
        resetSession();
        void ensureFocus();
      });
      unlistenBlur = await listen(TauriEvent.WINDOW_BLUR, () => {
        if (!dragStartRef.current) return;
        void cancelSelection();
      });
      if (cancelled && unlistenStart) unlistenStart();
      if (cancelled && unlistenBlur) unlistenBlur();
    })();

    window.addEventListener("mouseup", onUp);
    document.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyDown);
    document.addEventListener("keyup", onKeyDown);
    void ensureFocus();

    return () => {
      cancelled = true;
      unlistenStart?.();
      unlistenBlur?.();
      window.removeEventListener("mouseup", onUp);
      document.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyDown);
      document.removeEventListener("keyup", onKeyDown);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="relative w-screen h-screen select-none cursor-crosshair"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute inset-0 bg-black/30" />
      {rect && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-300/20"
          style={{
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.w}px`,
            height: `${rect.h}px`,
          }}
        />
      )}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/70 text-white text-xs">
        拖曳框選截圖範圍，Esc 取消
      </div>
    </div>
  );
}
