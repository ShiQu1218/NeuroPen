import type { PunctuationMode, SttLanguage } from "../store/useAppStore";

export const inferAppToneHint = (windowTitle: string) => {
  const lower = windowTitle.toLowerCase();
  if (/(word|excel|powerpoint|notion|docs|outlook|gmail|mail\.google)/.test(lower)) {
    return "Use formal and concise business writing style.";
  }
  if (/(discord|slack|line|wechat|telegram)/.test(lower)) {
    return "Use casual chat-friendly style.";
  }
  if (/(code|visual studio|github|terminal|powershell)/.test(lower)) {
    return "Keep technical terms and code symbols unchanged.";
  }
  return "Keep neutral and clear style.";
};

export const applyPunctuationMode = (text: string, mode: PunctuationMode) => {
  const base = text.trim();
  if (!base || mode === "off") return base;
  let normalized = base.replace(/\s+/g, " ");
  if (mode === "aggressive") {
    normalized = normalized
      .replace(/([，,;；])\s*/g, "$1 ")
      .replace(/([。.!?！？])\s*/g, "$1\n");
  }
  if (!/[。.!?！？]$/.test(normalized)) {
    normalized += "。";
  }
  return normalized;
};

export const normalizeSttEngine = (engine: string): "openAi" | "localWhisper" =>
  engine === "localWhisper" ? "localWhisper" : "openAi";

export const normalizeSttLanguage = (language: unknown): SttLanguage => {
  switch (String(language ?? "").trim().toLowerCase()) {
    case "zh":
    case "en":
    case "ja":
    case "ko":
    case "de":
    case "fr":
    case "es":
    case "ru":
    case "ar":
    case "auto":
      return String(language).trim().toLowerCase() as SttLanguage;
    default:
      return "auto";
  }
};

const containsNonLatinScript = (text: string) =>
  /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF]/.test(text);

export const isLikelyUnexpectedEnglishTranslation = (original: string, refined: string) => {
  if (!containsNonLatinScript(original) || containsNonLatinScript(refined)) {
    return false;
  }
  const condensed = refined.replace(/\s+/g, "");
  if (!condensed) return false;
  const latinCount = (condensed.match(/[A-Za-z]/g) ?? []).length;
  return latinCount / condensed.length > 0.6;
};

export const stripWrappingQuotes = (text: string) => {
  const pairs: Array<[string, string]> = [
    ["「", "」"],
    ["『", "』"],
    ["\"", "\""],
    ["'", "'"],
  ];
  const trimmed = text.trim();
  for (const [left, right] of pairs) {
    if (trimmed.startsWith(left) && trimmed.endsWith(right) && trimmed.length > left.length + right.length) {
      return trimmed.slice(left.length, trimmed.length - right.length).trim();
    }
  }
  return trimmed;
};

export const buildSelectionFingerprint = (
  selectionText: string,
  anchorX?: number | null,
  anchorY?: number | null,
) => `${selectionText || "__selection__"}::${
  typeof anchorX === "number" && typeof anchorY === "number"
    ? `${Math.round(anchorX)}::${Math.round(anchorY)}`
    : "__anchor__"
}`;
