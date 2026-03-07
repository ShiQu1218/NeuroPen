import type { QuickActionCommand } from "./appStoreTypes";

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

export const DEFAULT_LLM_MODEL_OPTIONS = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "claude-3-5-sonnet-latest",
  "gemini-2.5-flash",
  "deepseek-chat",
  "qwen-plus",
  "llama3.2",
];
