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
import { useAppStore, type AppLanguage, type ThemePreference } from "../store/useAppStore";

export default function RecordingIndicator() {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [partialText, setPartialText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [animKey, setAnimKey] = useState(0);
  const statusTextRef = useRef("");
  const isRecordingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setThemePreference = useAppStore((s) => s.setThemePreference);
  const setPartialTranscript = useAppStore((s) => s.setPartialTranscript);
  const { t } = useI18n();

  // Sync latest values into refs so setTimeout callbacks read current state
  // without stale closures. Assigning refs during render is safe and avoids
  // the overhead of two extra effects.
  statusTextRef.current = statusText;
  isRecordingRef.current = isRecording;

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

  const showAtBottomCenter = async () => {
    const win = getCurrentWindow();
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
    await win.show();
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
        setAnimKey((k) => k + 1);
        await showAtBottomCenter();
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

      const u3 = await listen<{ language?: AppLanguage; themePreference?: ThemePreference }>(
        "neuropen://settings-saved",
        (event) => {
          if (event.payload.language) {
            setLanguage(event.payload.language);
          }
          if (event.payload.themePreference) {
            setThemePreference(event.payload.themePreference);
          }
        }
      );
      if (cancelled) { u3(); } else { unlisten.push(u3); }

      const u5 = await listen<{ message?: string }>("neuropen://status", async (event) => {
        const message = (event.payload.message ?? "").trim();
        if (!message) {
          return;
        }
        clearHideTimer();
        setStatusText(message);
        statusTextRef.current = message;
        await showAtBottomCenter();
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
  }, [setLanguage, setPartialTranscript, setThemePreference]);

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
      <div key={animKey} className="flex max-w-[400px] items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg backdrop-blur-sm animate-scaleUp dark:bg-zinc-950/90 dark:text-zinc-100">
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${isRecording
            ? "bg-red-500 animate-pulse"
            : "bg-gray-400 dark:bg-zinc-500"
            }`}
        />
        {isRecording && partialText ? (
          <span className="truncate text-xs text-white/70 dark:text-zinc-400">{partialText}</span>
        ) : (
          <span>{isRecording ? t("recording.recording") : (statusText || t("recording.processing"))}</span>
        )}
        {isRecording && (
          <span className="ml-1 shrink-0 text-xs text-white/60 dark:text-zinc-500">
            {formatTime(elapsed)}
          </span>
        )}
      </div>
    </div>
  );
}
