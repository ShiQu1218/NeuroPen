/**
 * Recording Indicator
 *
 * Phase 2 implementation:
 * - Floating overlay shown during voice capture
 * - Listens to `stt://start` and `stt://stop` Tauri events
 * - Pulsing red dot animation while recording
 * - Auto-shows/hides the recording-indicator window
 */
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { useI18n } from "../i18n";
import { useAppStore, type AppLanguage } from "../store/useAppStore";

export default function RecordingIndicator() {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [partialText, setPartialText] = useState("");
  const [statusText, setStatusText] = useState("");
  const statusTextRef = useRef("");
  const isRecordingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setPartialTranscript = useAppStore((s) => s.setPartialTranscript);
  const { t } = useI18n();

  useEffect(() => {
    statusTextRef.current = statusText;
  }, [statusText]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const scheduleHide = (delayMs: number) => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (!isRecordingRef.current) {
        setStatusText("");
        statusTextRef.current = "";
        void getCurrentWindow().hide();
      }
    }, delayMs);
  };

  useEffect(() => {
    let cancelled = false;
    const unlisten: Array<() => void> = [];

    (async () => {
      const u1 = await listen("stt://start", async () => {
        clearHideTimer();
        setIsRecording(true);
        setElapsed(0);
        setPartialText("");
        setStatusText("");
        statusTextRef.current = "";
        setPartialTranscript("");
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
        setPartialText("");
        if (!statusTextRef.current) {
          scheduleHide(350);
        }
      });
      if (cancelled) { u2(); } else { unlisten.push(u2); }

      // Listen for partial transcription results
      const u4 = await listen<{ text: string }>("stt://partial", (event) => {
        setPartialText(event.payload.text);
        setPartialTranscript(event.payload.text);
      });
      if (cancelled) { u4(); } else { unlisten.push(u4); }

      const u3 = await listen<{ language?: AppLanguage }>(
        "talkflow://settings-saved",
        (event) => {
          if (event.payload.language) {
            setLanguage(event.payload.language);
          }
        }
      );
      if (cancelled) { u3(); } else { unlisten.push(u3); }

      const u5 = await listen<{ message?: string }>("talkflow://status", async (event) => {
        const message = (event.payload.message ?? "").trim();
        if (!message) {
          return;
        }
        clearHideTimer();
        setStatusText(message);
        statusTextRef.current = message;
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
          console.warn("[RecordingIndicator] status positioning failed:", err);
        }
        if (!isRecordingRef.current) {
          scheduleHide(1800);
        }
      });
      if (cancelled) { u5(); } else { unlisten.push(u5); }
    })();

    return () => {
      cancelled = true;
      clearHideTimer();
      unlisten.forEach((fn) => fn());
    };
  }, [setLanguage, setPartialTranscript]);

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
      <div className="flex items-center gap-2 bg-black/80 text-white px-4 py-2 rounded-full text-sm shadow-lg backdrop-blur-sm max-w-[400px]">
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            isRecording
              ? "bg-red-500 animate-pulse"
              : "bg-gray-400"
          }`}
        />
        {isRecording && partialText ? (
          <span className="text-white/70 text-xs truncate">{partialText}</span>
        ) : (
          <span>{isRecording ? t("recording.recording") : (statusText || t("recording.processing"))}</span>
        )}
        {isRecording && (
          <span className="text-white/60 text-xs ml-1 shrink-0">
            {formatTime(elapsed)}
          </span>
        )}
      </div>
    </div>
  );
}
