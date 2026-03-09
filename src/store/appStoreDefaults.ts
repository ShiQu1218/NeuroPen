import type { AppProfile, QuickActionCommand } from "./appStoreTypes";

export const normalizeLlmModelOptions = (models: string[], activeModel?: string) =>
  Array.from(
    new Set(
      [...models, activeModel ?? ""]
        .map((model) => model.trim())
        .filter(Boolean)
    )
  );

export const DEFAULT_QUICK_ACTION_COMMANDS: QuickActionCommand[] = [
  { id: "translate", label: "翻譯成英文", instruction: "Translate the selected text to English." },
  { id: "summarize", label: "摘要", instruction: "Summarize the selected text concisely." },
  { id: "grammar", label: "修正語法", instruction: "Fix grammar and spelling errors in the selected text." },
  { id: "formalize", label: "正式化", instruction: "Rewrite the selected text in a formal tone." },
];

export const DEFAULT_APP_PROFILES: AppProfile[] = [
  {
    id: "preset-notion",
    name: "Notion",
    keywords: ["notion"],
    enabled: true,
    applyToModes: ["A", "B1", "B2", "C"],
    toneHint: "Use formal and concise business writing style.",
    promptAppendix: "",
    preferredLanguage: "",
    outputMode: "",
    directPaste: null,
  },
  {
    id: "preset-word-docs",
    name: "Word / Docs",
    keywords: ["word", "docs", "google docs"],
    enabled: true,
    applyToModes: ["A", "B1", "B2", "C"],
    toneHint: "Use formal and concise business writing style.",
    promptAppendix: "",
    preferredLanguage: "",
    outputMode: "",
    directPaste: null,
  },
  {
    id: "preset-vscode",
    name: "VS Code",
    keywords: ["visual studio code", "code -"],
    enabled: true,
    applyToModes: ["A", "B1", "B2", "C"],
    toneHint: "Keep technical terms and code symbols unchanged.",
    promptAppendix: "",
    preferredLanguage: "",
    outputMode: "",
    directPaste: null,
  },
  {
    id: "preset-chat",
    name: "LINE / Discord",
    keywords: ["line", "discord", "slack", "telegram", "wechat"],
    enabled: true,
    applyToModes: ["A", "B1", "B2"],
    toneHint: "Use casual chat-friendly style. Keep messages short.",
    promptAppendix: "",
    preferredLanguage: "",
    outputMode: "DirectInject",
    directPaste: true,
  },
  {
    id: "preset-email",
    name: "Gmail / Outlook",
    keywords: ["gmail", "mail.google", "outlook"],
    enabled: true,
    applyToModes: ["A", "B1", "B2", "C"],
    toneHint: "Use formal email writing style.",
    promptAppendix: "",
    preferredLanguage: "",
    outputMode: "",
    directPaste: null,
  },
];

export const DEFAULT_LLM_MODEL_OPTIONS = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "claude-3-5-sonnet-latest",
  "gemini-2.5-flash",
  "deepseek-chat",
  "qwen-plus",
  "llama3.2",
];
