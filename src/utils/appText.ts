import type { AppProfile, AppProfileMode, PunctuationMode, SttLanguage } from "../store/useAppStore";

export const resolveAppProfile = (
  windowTitle: string,
  profiles: AppProfile[],
  mode: AppProfileMode,
): AppProfile | null => {
  if (!windowTitle) return null;
  const lower = windowTitle.toLowerCase();
  return (
    profiles.find(
      (p) =>
        p.enabled &&
        p.applyToModes.includes(mode) &&
        p.keywords.some((kw) => lower.includes(kw.toLowerCase())),
    ) ?? null
  );
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

/**
 * Apply a regex replacement only to text segments that lie **outside** of
 * `$…$` and `$$…$$` math spans.  Math spans are returned unchanged.
 *
 * This prevents text-formatting heuristics (list-prefix insertion, sentence
 * breaking, etc.) from corrupting LaTeX expressions that happen to contain
 * characters like `- `, `!`, or `;`.
 */
const replaceOutsideMath = (
  text: string,
  pattern: RegExp,
  replacement: string,
): string => {
  const mathRe = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g;
  const parts: string[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = mathRe.exec(text)) !== null) {
    if (m.index > cursor) {
      parts.push(text.slice(cursor, m.index).replace(pattern, replacement));
    }
    parts.push(m[0]); // math span — unchanged
    cursor = m.index + m[0].length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor).replace(pattern, replacement));
  }

  return parts.join("");
};

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

  result = replaceOutsideMath(result, /([^\n])((?:\(?\d{1,3}[.)]\s+))/g, "$1\n$2");
  result = replaceOutsideMath(result, /([^\n])((?:[-*+•]\s+))/g, "$1\n$2");

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

export const normalizeStructuredText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const normalizeSttEngine = (engine: string): "openAi" | "localWhisper" | "senseVoice" | "moonshine" => {
  switch (engine) {
    case "localWhisper":
    case "senseVoice":
    case "moonshine":
      return engine;
    default:
      return "openAi";
  }
};

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

export const looksLikeMarkdown = (text: string) =>
  /(^|\n)(#{1,6}\s|[-*+•]\s|\(?\d{1,3}[.)]\s|>\s|```|\|.+\|)/m.test(text);

export const looksLikeGfmMarkdown = (text: string) =>
  /(^|\n)\|.+\|(?:\n|\r\n?)\|?(?:\s*:?-+:?\s*\|)+\s*$|(^|\n)\s*[-*+]\s+\[(?: |x|X)\]\s+|~~[^~\n][\s\S]*?~~|(^|[\s(])(https?:\/\/|www\.)\S+|(^|\n)\[\^[^\]]+\]|\n\[\^[^\]]+\]:/m.test(
    text,
  );

export const looksLikeMathMarkdown = (text: string) =>
  /(^|[^\\])\$\$[\s\S]+?\$\$|(^|[^\\])\$[^$\n]+?\$|\\\((?:[\s\S]+?)\\\)|\\\[(?:[\s\S]+?)\\\]|\\begin\{[a-zA-Z*]+\}/m.test(
    text,
  );

/**
 * Normalise math blocks for remark-math compatibility.  Two problems are addressed:
 *
 * 1. **Single-line `$$…$$` display math.**
 *    `remark-math` (via `micromark-extension-math`) treats `$$` at line start as the
 *    opening fence of a display-math block and expects the closing `$$` on a *separate*
 *    line.  When an LLM produces `$$formula$$` on one line — especially indented inside
 *    list items — the parser sees the first `$$` as opening a block, keeps consuming
 *    subsequent content as raw math text, and breaks numbered-list markers.
 *
 * 2. **Standalone `$…$` on its own line.**
 *    When consecutive lines each contain a single `$…$` block, markdown collapses
 *    them into one paragraph (single newlines become spaces).  Adjacent inline-math
 *    blocks inside the same paragraph can cause remark-math to fail on the second
 *    block onward.  Promoting standalone `$…$` to display math (`$$`) avoids the
 *    collapse and gives proper block-level rendering.
 *
 * In both cases the output is multi-line `$$\ncontent\n$$` with preserved indentation
 * and surrounding blank lines for clean block separation.  Code-fenced regions are
 * left untouched.
 */
export const normalizeMathBlocks = (text: string): string => {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let inCodeFence = false;
  const result: string[] = [];

  const pushDisplayBlock = (indent: string, content: string) => {
    // Blank line before the block when the preceding line is non-blank.
    if (result.length > 0 && result[result.length - 1].trim() !== "") {
      result.push("");
    }
    result.push(`${indent}$$`);
    result.push(`${indent}${content}`);
    result.push(`${indent}$$`);
    result.push(""); // blank line after
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }
    if (inCodeFence) {
      result.push(line);
      continue;
    }

    // Case 1: Single-line $$...$$ display math → multi-line format.
    // The non-greedy `.+?` avoids false matches on lines like `$$a$$ text $$b$$`.
    const matchDouble = line.match(/^([ \t]*)\$\$(.+?)\$\$[ \t]*$/);
    if (matchDouble) {
      pushDisplayBlock(matchDouble[1], matchDouble[2].trim());
      continue;
    }

    // Case 2: Standalone $...$ inline math (sole content on the line) → promote to
    // display math.  `[^$]+` ensures we only match a single $…$ pair and avoids
    // matching `$$` or lines with multiple inline-math blocks.
    const matchSingle = line.match(/^([ \t]*)\$([^$]+)\$[ \t]*$/);
    if (matchSingle) {
      pushDisplayBlock(matchSingle[1], matchSingle[2].trim());
      continue;
    }

    result.push(line);
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n");
};

export const normalizePreviewMarkdown = (text: string) => {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";

  // Use replaceOutsideMath so that list-prefix heuristics never insert line
  // breaks inside $…$ or $$…$$ math spans (e.g. `- ` as subtraction, `1.` as
  // a decimal, etc.).

  // --- Inline list-prefix separation ---
  // When a list prefix immediately follows text on the same line (no newline),
  // insert a blank line so markdown sees a proper block boundary.
  let result = replaceOutsideMath(
    normalized,
    /([^\n])((?:\(?\d{1,3}[.)]\s+))/g,
    "$1\n\n$2",
  );
  result = replaceOutsideMath(
    result,
    /([^\n])((?:[-*+•]\s+))/g,
    "$1\n\n$2",
  );

  // --- Single-newline list-prefix separation ---
  // When a list item follows non-list text with only a single newline,
  // markdown treats it as a lazy continuation line (CommonMark §5.4) instead
  // of a new list block.  Upgrade the single newline to a blank line so the
  // parser sees a proper paragraph → list transition.
  result = replaceOutsideMath(
    result,
    /([^\n])\n(\(?\d{1,3}[.)]\s+)/g,
    "$1\n\n$2",
  );
  result = replaceOutsideMath(
    result,
    /([^\n])\n([-*+•]\s+)/g,
    "$1\n\n$2",
  );

  // --- Post-list paragraph separation ---
  // When non-list text follows the last list item with only a single newline,
  // insert a blank line so markdown ends the list before the next paragraph.
  // Matches: end-of-list-item-line \n non-list-non-blank-text.
  result = replaceOutsideMath(
    result,
    /(\n(?:\(?\d{1,3}[.)]\s+|[-*+•]\s+)[^\n]+)\n(?!\n)(?!\(?\d{1,3}[.)]\s)(?![-*+•]\s)(?!#{1,6}\s)(?!```)/g,
    "$1\n\n",
  );

  result = result.replace(/\n{3,}/g, "\n\n");

  if (!looksLikeMarkdown(result)) {
    const sentenceBreakCount = (result.match(/[.!?;。！？；]/g) ?? []).length;
    if (!result.includes("\n\n") && sentenceBreakCount >= 2) {
      result = replaceOutsideMath(result, /([.!?;。！？；])\s*/g, "$1\n\n");
    }
  }

  return result.replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSelectionFingerprint = (
  selectionText: string,
  anchorX?: number | null,
  anchorY?: number | null,
) => {
  void anchorX;
  void anchorY;
  // Selection quick-action dedupe should track the highlighted text itself.
  // Cursor release coordinates are too unstable because clicks on preview or
  // other UI surfaces can move the pointer while the original selection stays.
  return (selectionText || "__selection__").trim();
};
