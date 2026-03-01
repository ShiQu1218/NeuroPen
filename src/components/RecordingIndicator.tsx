/**
 * Recording Indicator
 *
 * Phase 2 implementation:
 * - Floating overlay shown during voice capture
 * - Listens to `stt://start` and `stt://stop` Tauri events
 * - Pulsing red dot animation while recording
 * - Auto-shows/hides the recording-indicator window
 */
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";

export default function RecordingIndicator() {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const unlisten: Array<() => void> = [];

    (async () => {
      const u1 = await listen("stt://start", async () => {
        setIsRecording(true);
        setElapsed(0);
        const win = getCurrentWindow();
        await win.center();
        await win.show();
        try {
          const monitor = await currentMonitor();
          const size = await win.outerSize();
          if (monitor) {
            const x = monitor.position.x + Math.floor((monitor.size.width - size.width) / 2);
            const y = monitor.position.y + monitor.size.height - size.height - 36;
            await win.setPosition(new PhysicalPosition(x, y));
          }
        } catch (err) {
          console.warn("[RecordingIndicator] positioning failed:", err);
        }
      });
      if (cancelled) { u1(); } else { unlisten.push(u1); }

      const u2 = await listen("stt://stop", () => {
        setIsRecording(false);
        setElapsed(0);
        setTimeout(() => { getCurrentWindow().hide(); }, 300);
      });
      if (cancelled) { u2(); } else { unlisten.push(u2); }
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  // Elapsed timer
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center justify-center w-full h-full bg-transparent">
      <div className="flex items-center gap-2 bg-black/80 text-white px-4 py-2 rounded-full text-sm shadow-lg backdrop-blur-sm">
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            isRecording
              ? "bg-red-500 animate-pulse"
              : "bg-gray-400"
          }`}
        />
        <span>{isRecording ? "錄音中" : "處理中…"}</span>
        {isRecording && (
          <span className="text-white/60 text-xs ml-1">
            {formatTime(elapsed)}
          </span>
        )}
      </div>
    </div>
  );
}
