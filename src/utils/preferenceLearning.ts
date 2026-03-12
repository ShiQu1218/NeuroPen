import type { QuickActionCommand } from "../store/useAppStore";

export type PreferenceFeedbackRating = "up" | "down";

export interface PreferenceCategoryMetadata {
  key: string;
  label: string;
  quickActionCommandId?: string;
}

export interface PreferenceSummaryView {
  categoryKey: string;
  categoryLabel: string;
  quickActionCommandId?: string;
  summary?: string | null;
  updatedAt?: number | null;
  pendingCount: number;
}

interface HistoryPreferenceLike {
  instruction: string;
  requestId?: string;
  preferenceCategoryKey?: string;
  preferenceCategoryLabel?: string;
  quickActionCommandId?: string;
}

const OTHER_CATEGORY_KEY = "other";
const PREFERENCE_PROMPT_PREFIX =
  "Learned user output preferences for this category:\n";

export function hashPreferenceInstruction(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildQuickActionPreferenceCategory(
  command: Pick<QuickActionCommand, "id" | "label" | "instruction">,
): PreferenceCategoryMetadata {
  const instructionHash = hashPreferenceInstruction(command.instruction.trim());
  return {
    key: `quickAction:${command.id}:${instructionHash}`,
    label: command.label.trim() || command.instruction.trim() || command.id,
    quickActionCommandId: command.id,
  };
}

export function buildOtherPreferenceCategory(otherLabel: string): PreferenceCategoryMetadata {
  return {
    key: OTHER_CATEGORY_KEY,
    label: otherLabel.trim() || "Other",
  };
}

export function composePromptOverride(
  basePrompt: string,
  promptAppendix = "",
  learnedSummary = "",
): string {
  const parts = [
    basePrompt.trim(),
    promptAppendix.trim(),
    learnedSummary.trim()
      ? `${PREFERENCE_PROMPT_PREFIX}${learnedSummary.trim()}`
      : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

export function generatePreferenceRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function resolveHistoryPreferenceCategory(
  entry: HistoryPreferenceLike,
  quickActionCommands: QuickActionCommand[],
  otherLabel: string,
): PreferenceCategoryMetadata {
  if (entry.preferenceCategoryKey?.trim()) {
    return {
      key: entry.preferenceCategoryKey.trim(),
      label: entry.preferenceCategoryLabel?.trim() || otherLabel,
      quickActionCommandId: entry.quickActionCommandId?.trim() || undefined,
    };
  }

  const instruction = entry.instruction.trim();
  if (instruction) {
    const matchedCommand = quickActionCommands.find(
      (command) => command.instruction.trim() === instruction,
    );
    if (matchedCommand) {
      return buildQuickActionPreferenceCategory(matchedCommand);
    }
  }

  return buildOtherPreferenceCategory(otherLabel);
}

export function resolveHistoryRequestId(entry: Pick<HistoryPreferenceLike, "requestId"> & { id?: string }) {
  const requestId = entry.requestId?.trim();
  if (requestId) {
    return requestId;
  }
  return `history:${entry.id ?? Date.now().toString()}`;
}
