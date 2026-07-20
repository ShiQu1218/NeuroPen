import { settingsService } from "../services/settingsService";
import {
  getDefaultLlmModel,
  getDefaultLlmModelOptions,
  isLocalRuntimeLlmProvider,
  normalizeLlmModelOptions,
} from "../store/appStoreDefaults";
import type { LlmProvider } from "../store/useAppStore";

export interface LlmSettingsSavedPayload {
  llmProvider?: LlmProvider;
  llmModel?: string;
  llmModelOptions?: string[];
}

export interface ResolvedLlmProviderModelState {
  nextModel: string;
  nextOptions: string[];
  discoveryStatus: "not-required" | "available" | "empty" | "unavailable";
  discoveryError?: string;
}

interface ResolveLlmProviderModelStateOptions {
  preferredModel?: string;
  rememberedModel?: string;
  modelOptions?: string[];
}

const normalizeRuntimeModelCatalog = (models: string[]) =>
  Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));

export async function resolveLlmProviderModelState(
  provider: LlmProvider,
  {
    preferredModel,
    rememberedModel,
    modelOptions,
  }: ResolveLlmProviderModelStateOptions,
): Promise<ResolvedLlmProviderModelState> {
  const requestedModel = preferredModel?.trim() || rememberedModel?.trim() || "";

  if (isLocalRuntimeLlmProvider(provider)) {
    const fallbackModel = getDefaultLlmModel(provider);
    const fallbackOptions = normalizeRuntimeModelCatalog([fallbackModel]);
    try {
      const discoveredModels = normalizeRuntimeModelCatalog(
        await settingsService.listAvailableLlmModels(provider),
      );
      if (discoveredModels.length === 0) {
        return {
          nextModel: requestedModel || fallbackModel,
          nextOptions: normalizeRuntimeModelCatalog(modelOptions ?? []),
          discoveryStatus: "empty",
        };
      }
      const nextOptions = discoveredModels;
      const nextModel =
        requestedModel && nextOptions.includes(requestedModel)
          ? requestedModel
          : nextOptions[0] ?? fallbackModel;
      return { nextModel, nextOptions, discoveryStatus: "available" };
    } catch (error) {
      const discoveryError = error instanceof Error ? error.message : String(error);
      const retainedModel = requestedModel || fallbackModel;
      return {
        nextModel: retainedModel,
        nextOptions: normalizeRuntimeModelCatalog([
          retainedModel,
          ...(modelOptions ?? []),
          ...fallbackOptions,
        ]),
        discoveryStatus: "unavailable",
        discoveryError,
      };
    }
  }

  const nextModel = requestedModel || getDefaultLlmModel(provider);
  const nextOptions = normalizeLlmModelOptions(
    modelOptions ?? getDefaultLlmModelOptions(provider),
    nextModel,
  );
  return { nextModel, nextOptions, discoveryStatus: "not-required" };
}
