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
      .replace(/([,;:，؛؛：、])\s*/g, "$1 ")
      .replace(/([.!?;。！？；])\s*/g, "$1\n");
  }
  return normalized;
};

const SENTENCE_BOUNDARY_RE = /([.!?;。！？؛；]+)\s*/g;
const CLAUSE_BOUNDARY_RE = /([,;:，、：؛；])\s*/g;
const LIST_PREFIX_RE = /^(?:\(?\d{1,3}[.)]\s+|[-*+•]\s+)/;

const buildParagraphs = (
  parts: string[],
  options: { maxParts: number; maxChars: number }
) => {
  const paragraphs: string[] = [];
  let bucket: string[] = [];
  let bucketChars = 0;

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;

    const forceBreak = LIST_PREFIX_RE.test(part);
    const projectedChars = bucketChars + (bucket.length > 0 ? 1 : 0) + part.length;
    const shouldBreak =
      bucket.length > 0 &&
      (forceBreak || bucket.length >= options.maxParts || projectedChars > options.maxChars);

    if (shouldBreak) {
      paragraphs.push(bucket.join(" ").trim());
      bucket = [];
      bucketChars = 0;
    }

    bucket.push(part);
    bucketChars += (bucketChars > 0 ? 1 : 0) + part.length;
  }

  if (bucket.length > 0) {
    paragraphs.push(bucket.join(" ").trim());
  }

  return paragraphs;
};

const chunkCompactText = (text: string, chunkSize: number) => {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize).trim());
    start += chunkSize;
  }
  return chunks.filter(Boolean);
};

export const formatModeAText = (text: string) => {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";

  if (looksLikeMarkdown(normalized)) {
    return normalizePreviewMarkdown(normalized);
  }

  let result = normalized
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ");

  result = result
    .replace(/([^\n])((?:\(?\d{1,3}[.)]\s+))/g, "$1\n$2")
    .replace(/([^\n])((?:[-*+•]\s+))/g, "$1\n$2");

  const sentenceParts = result
    .replace(SENTENCE_BOUNDARY_RE, "$1\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length >= 2) {
    result = buildParagraphs(sentenceParts, {
      maxParts: 2,
      maxChars: 72,
    }).join("\n\n");
  }

  const hasParagraphs = result.includes("\n\n");
  const hasSentenceStops = /[.!?;。！？؛；]/.test(result);
  const isLongCompactLine =
    !hasParagraphs &&
    result.length >= 36 &&
    !looksLikeMarkdown(result);

  if (isLongCompactLine && !hasSentenceStops) {
    const clauseParts = result
      .replace(CLAUSE_BOUNDARY_RE, "$1\n")
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (clauseParts.length >= 2) {
      result = buildParagraphs(clauseParts, {
        maxParts: 2,
        maxChars: 56,
      }).join("\n\n");
    } else if (result.length >= 56) {
      result = chunkCompactText(result, 32).join("\n\n");
    }
  }

  return result
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
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

const looksLikeMarkdown = (text: string) =>
  /(^|\n)(#{1,6}\s|[-*+•]\s|\(?\d{1,3}[.)]\s|>\s|```|\|.+\|)/m.test(text);

export const normalizePreviewMarkdown = (text: string) => {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";

  let result = normalized
    .replace(/([^\n])((?:\(?\d{1,3}[.)]\s+))/g, "$1\n\n$2")
    .replace(/([^\n])((?:[-*+•]\s+))/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n");

  if (!looksLikeMarkdown(result)) {
    const sentenceBreakCount = (result.match(/[.!?;。！？；]/g) ?? []).length;
    if (!result.includes("\n\n") && sentenceBreakCount >= 2) {
      result = result.replace(/([.!?;。！？；])\s*/g, "$1\n\n");
    }
  }

  return result.replace(/\n{3,}/g, "\n\n").trim();
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
