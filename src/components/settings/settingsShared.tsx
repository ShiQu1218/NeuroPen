import type { JSX } from "react";

export interface LocalSttModel {
  id: string;
  name: string;
  description: string;
  speed: number;
  accuracy: number;
  downloadUrl: string;
  fileName: string;
  installed: boolean;
  active: boolean;
  modelPath: string;
  engine: string;
}

export interface LocalTtsModel {
  id: string;
  name: string;
  description: string;
  language: string;
  quality: string;
  speakerCount: number;
  downloadUrl: string;
  fileName: string;
  installed: boolean;
  active: boolean;
  modelPath: string;
}

export interface ModelDownloadProgressEvent {
  modelId: string;
  status: "start" | "downloading" | "done" | "cancelled" | "error";
  downloadedBytes?: number;
  totalBytes?: number;
  progressPct?: number;
}

export interface RegisteredHotkeys {
  triggerHotkey: string;
  triggerPersisted: boolean;
  screenshotHotkey: string;
  screenshotPersisted: boolean;
  dialogHotkey: string;
  dialogPersisted: boolean;
}

export type SettingsSection = "general" | "stt" | "quickAction" | "llm" | "tts" | "history" | "appProfile";

export const STATUS_RESET_MS = 2000;
export const RATING_INDICES = [0, 1, 2, 3, 4];
export const OPENAI_STT_MODEL = "openai-whisper-api";

export const NAV_ITEMS: { id: SettingsSection; icon: JSX.Element }[] = [
  {
    id: "general",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3v4m0 10v4m9-9h-4M7 12H3m14.364 6.364-2.828-2.828M9.464 9.464 6.636 6.636m10.728 0-2.828 2.828M9.464 14.536l-2.828 2.828" />
      </svg>
    ),
  },
  {
    id: "stt",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6" />
      </svg>
    ),
  },
  {
    id: "quickAction",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 7h10v10H7z" />
        <path d="M3 12h2m14 0h2M12 3v2m0 14v2" />
      </svg>
    ),
  },
  {
    id: "llm",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.2 4.5 3 5.7V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.3c1.8-1.2 3-3.2 3-5.7a7 7 0 0 0-7-7Z" />
        <path d="M9 21h6M10 17v4M14 17v4" />
        <path d="M9 10h0M15 10h0" />
        <path d="M9.5 13a3.5 3.5 0 0 0 5 0" />
      </svg>
    ),
  },
  {
    id: "tts",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    ),
  },
  {
    id: "history",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: "appProfile",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
];
