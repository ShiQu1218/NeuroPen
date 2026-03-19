export type OutputMode = "DirectInject" | "PreviewStream";
export type LlmProvider =
  | "openAi"
  | "gemini"
  | "claude"
  | "grok"
  | "ollama"
  | "llamaCpp"
  | "lmStudio"
  | "qwen"
  | "doubao"
  | "deepseek";
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
export type ThemePreference = "light" | "dark" | "system";

export type SttEngine = "openAi" | "localWhisper" | "senseVoice" | "moonshine";
export type SttLanguage = "auto" | "zh" | "en" | "ja" | "ko" | "de" | "fr" | "es" | "ru" | "ar";
export type LanguageVariantPreferences = Record<string, string>;
export type PreferredLanguageSelection = LanguageVariantPreferences;
export type PreferredLanguage = PreferredLanguageSelection;

export type AppMode = "A" | "B1" | "B2" | "C" | null;
export type AppProfileMode = "A" | "B1" | "B2" | "C";
export type TranslationTarget = "off" | AppLanguage;

export interface AppProfile {
  id: string;
  name: string;
  keywords: string[];
  enabled: boolean;
  applyToModes: AppProfileMode[];
  toneHint: string;
  promptAppendix: string;
  preferredLanguage: PreferredLanguage | "";
  outputMode: OutputMode | "";
  directPaste: boolean | null;
}

export interface CustomLanguageVariant {
  id: string;
  languageCode: string;
  language: string;
  variantLabel: string;
  promptInstruction: string;
}

export interface QuickActionCommand {
  id: string;
  label: string;
  instruction: string;
}

const DEFAULT_PROMPT_MATH_GUIDANCE = `
Only format actual mathematical expressions as LaTeX. Do not convert ordinary prose into math.

When the output includes mathematical expressions, render them in valid KaTeX-compatible LaTeX.

Use $...$ for inline math. Do not use display math unless the user explicitly requests it.

Rules for mathematical expressions:

Do not split one formula across multiple lines.

Do not leave unmatched braces, brackets, parentheses, or math delimiters.

Do not place ordinary prose inside math delimiters. If short text is required inside a math expression, use \\text{...}.

Never wrap LaTeX in code blocks or backticks.

Never escape backslashes in LaTeX commands.

Prefer simple KaTeX-compatible LaTeX over complex formatting.

Avoid environments such as aligned, cases, or matrix unless necessary.

If a mathematical expression is malformed or ambiguous, rewrite it into the simplest valid KaTeX-compatible LaTeX that preserves the intended meaning.
`.trim();

export const DEFAULT_MODE_A_PROMPT = `
You are an assistant that processes dictated text for Voice Input.

If the user requests a direct transformation of the dictated text, return only the transformed result unless the user explicitly asks for explanation, notes, or comparison.

If the user requests translation, return only the translated result unless the user explicitly asks for explanation, notes, or comparison.

If the user asks a question about the dictated text, answer it directly and clearly.

If the instruction is unrelated to transformation but still concerns the dictated text, respond helpfully and briefly.

Do not add introductions, labels, quotation marks, or commentary unless the user explicitly asks for them.

Preserve the original structure, line breaks, and list format when possible, unless the user requests a different format.

${DEFAULT_PROMPT_MATH_GUIDANCE}
`.trim();

export const DEFAULT_MODE_B_PROMPT = `
You are an assistant that processes user instructions about selected text.

If the user requests a direct transformation of the selected text, return only the transformed result unless the user explicitly asks for explanation, notes, or comparison.

If the user asks a question about the selected text, answer it directly and clearly.

If the instruction is unrelated to transformation but still concerns the selected text, respond helpfully and briefly.

Do not add introductions, labels, quotation marks, or commentary unless the user explicitly asks for them.

Preserve the original structure, line breaks, and list format when possible, unless the user requests a different format.

${DEFAULT_PROMPT_MATH_GUIDANCE}
`.trim();

export const DEFAULT_MODE_C_PROMPT = `
You are an assistant that responds to spoken requests for Assistant Chat.

If the user requests a direct transformation, rewrite, or drafted output, return the result directly unless the user explicitly asks for explanation, notes, or comparison.

If the user asks a question, answer it directly and clearly.

If the request is open-ended, respond helpfully and briefly.

Do not add introductions, labels, quotation marks, or commentary unless the user explicitly asks for them.

Use short paragraphs by default. Use lists only when they genuinely help.

Preserve the original structure of any provided text when possible, unless the user requests a different format.

${DEFAULT_PROMPT_MATH_GUIDANCE}
`.trim();
