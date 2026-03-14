import type { TranslationKey } from "../i18n";
import type { AppMode, AppProfileMode } from "../store/useAppStore";

type ActiveAppMode = Exclude<AppMode, null>;
export const APP_WORKFLOW_LABEL_KEYS: Record<ActiveAppMode, TranslationKey> = {
  A: "workflow.voiceInput",
  B1: "workflow.quickAction",
  B2: "workflow.selectionVoiceCommand",
  C: "workflow.assistantChat",
};

export function formatAppWorkflowLabels(
  modes: AppProfileMode[],
  translate: (key: TranslationKey) => string,
) {
  return modes.map((mode) => translate(APP_WORKFLOW_LABEL_KEYS[mode])).join(" / ");
}
