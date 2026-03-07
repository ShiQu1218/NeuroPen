export type OutputMode = "DirectInject" | "PreviewStream";
export type LlmProvider = "openAi" | "gemini" | "claude" | "grok" | "ollama" | "qwen" | "doubao" | "deepseek";
export type SttOutputStrategy = "raw" | "llmRefine";
export type PunctuationMode = "off" | "balanced" | "aggressive";
export type AppLanguage =
  | "zh-TW"
  | "en-US"
  | "ja-JP"
  | "es-ES"
  | "ko-KR"
  | "zh-CN"
  | "de-DE"
  | "fr-FR"
  | "ar-SA"
  | "ru-RU";

export type SttEngine = "openAi" | "localWhisper";
export type SttLanguage = "auto" | "zh" | "en" | "ja" | "ko" | "de" | "fr" | "es" | "ru" | "ar";
export type PreferredLanguage = "auto" | AppLanguage;

export type AppMode = "A" | "B1" | "B2" | "C" | null;
export type TranslationTarget = "off" | AppLanguage;

export interface QuickActionCommand {
  id: string;
  label: string;
  instruction: string;
}

export const DEFAULT_MODE_A_PROMPT =
  "Rewrite the transcript into a clean final text. Preserve the original meaning and order, improve readability, and use natural paragraphs only when they help. Avoid over-formatting, avoid unnecessary headings, and output only the final text. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.";

export const DEFAULT_MODE_B_PROMPT =
  "You are handling selected-text commands for Mode B. If the instruction is a transformation request, output only the transformed text. If the instruction is asking about the selected text, answer directly in clean Markdown with short paragraphs and bullets only when they help. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.";

export const DEFAULT_MODE_C_PROMPT =
  "You are handling spoken assistant queries for Mode C. Reply in clean Markdown like a polished Typeless-style response: short paragraphs, meaningful bullet lists when useful, no filler opening lines, and no unnecessary headings for simple answers. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.";
