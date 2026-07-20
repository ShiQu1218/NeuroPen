import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import {
  Menu,
  type CheckMenuItemOptions,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { useI18n } from "../i18n";
import {
  getDefaultLlmModel,
  getDefaultLlmModelOptions,
  isLocalRuntimeLlmProvider,
  LLM_PROVIDER_KEYS,
  normalizeLlmModelOptions,
} from "../store/appStoreDefaults";
import { useAppStore, type LlmProvider } from "../store/useAppStore";
import {
  resolveLlmProviderModelState,
  type LlmSettingsSavedPayload,
} from "../utils/llmProviderModels";

type Translate = ReturnType<typeof useI18n>["t"];
type TrayMenuItem =
  | MenuItemOptions
  | CheckMenuItemOptions
  | PredefinedMenuItemOptions
  | SubmenuOptions;

interface LocalModelCatalog {
  status: "loading" | "available" | "empty" | "unavailable";
  models: string[];
  message?: string;
}

const TRAY_ID = "neuropen-tray";
const localModelCatalogs = new Map<LlmProvider, LocalModelCatalog>();
const localRefreshVersions = new Map<LlmProvider, number>();

let trayIcon: TrayIcon | null = null;
let activeMenu: Menu | null = null;
let latestTranslate: Translate | null = null;
let rebuildVersion = 0;
let rebuildQueue: Promise<void> = Promise.resolve();
let missingTrayRetryCount = 0;

function getProviderLabel(provider: LlmProvider, t: Translate) {
  switch (provider) {
    case "openAi": return "OpenAI";
    case "gemini": return "Gemini";
    case "claude": return "Claude";
    case "grok": return "Grok";
    case "openRouter": return "OpenRouter";
    case "qwen": return "Qwen";
    case "doubao": return "豆包 Doubao";
    case "deepseek": return "DeepSeek";
    case "ollama": return t("settings.llm.ollamaLocal");
    case "llamaCpp": return t("settings.llm.llamaCppLocal");
    case "lmStudio": return t("settings.llm.lmStudioLocal");
  }
}

function compactMenuMessage(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function runTrayAction(action: () => Promise<void>) {
  void action().catch((error) => {
    console.error("[Tray] LLM menu action failed:", error);
  });
}

async function persistProviderModel(
  provider: LlmProvider,
  model: string,
  modelOptions: string[],
) {
  const nextOptions = normalizeLlmModelOptions(modelOptions, model);
  const store = useAppStore.getState();
  store.setLlmProvider(provider);
  store.setLlmModel(model);
  store.setLlmModelOptions(nextOptions);
  await emit("neuropen://settings-saved", {
    llmProvider: provider,
    llmModel: model,
    llmModelOptions: nextOptions,
  } satisfies LlmSettingsSavedPayload);
}

function buildLocalModelItems(
  provider: LlmProvider,
  menuVersion: number,
  t: Translate,
): TrayMenuItem[] {
  const state = useAppStore.getState();
  const catalog = localModelCatalogs.get(provider);
  const models = catalog?.models ?? [];
  const items: TrayMenuItem[] = models.map((model, index) => ({
    id: `tray-llm-local-model-${menuVersion}-${provider}-${index}`,
    text: model,
    checked: provider === state.llmProvider && model === state.llmModel,
    action: () => {
      runTrayAction(() => persistProviderModel(provider, model, models));
    },
  }));

  if (items.length > 0) {
    items.push({ item: "Separator" });
  }

  if (catalog?.status === "loading") {
    items.push({ text: `↻ ${t("settings.llm.model")}…`, enabled: false });
    return items;
  }

  if (catalog?.status === "empty") {
    items.push({
      text: `⚠ ${compactMenuMessage(t("settings.llm.noLocalModels"))}`,
      enabled: false,
    });
  } else if (catalog?.status === "unavailable" && catalog.message) {
    items.push({ text: `⚠ ${compactMenuMessage(catalog.message)}`, enabled: false });
  }

  if (catalog?.status === "empty" || catalog?.status === "unavailable") {
    items.push({ item: "Separator" });
  }
  items.push({
    id: `tray-llm-refresh-${menuVersion}-${provider}`,
    text: `↻ ${t("settings.llm.model")}…`,
    action: () => {
      runTrayAction(() => refreshLocalModels(provider));
    },
  });
  return items;
}

function buildProviderSubmenus(menuVersion: number, t: Translate): SubmenuOptions[] {
  const state = useAppStore.getState();
  return LLM_PROVIDER_KEYS.map((provider) => {
    const rememberedModel = state.llmSelectedModelByProvider[provider]?.trim()
      || getDefaultLlmModel(provider);
    const models = normalizeLlmModelOptions(
      state.llmModelOptionsByProvider[provider] ?? getDefaultLlmModelOptions(provider),
      rememberedModel,
    );
    const modelItems: TrayMenuItem[] = isLocalRuntimeLlmProvider(provider)
      ? buildLocalModelItems(provider, menuVersion, t)
      : models.map((model, index) => ({
          id: `tray-llm-model-${menuVersion}-${provider}-${index}`,
          text: model,
          checked: provider === state.llmProvider && model === state.llmModel,
          action: () => {
            runTrayAction(() => persistProviderModel(provider, model, models));
          },
        }));

    return {
      id: `tray-llm-provider-${menuVersion}-${provider}`,
      text: `${provider === state.llmProvider ? "✓ " : ""}${getProviderLabel(provider, t)}`,
      items: modelItems,
    };
  });
}

async function replaceTrayMenu(menuVersion: number) {
  const t = latestTranslate;
  if (!t) {
    return;
  }

  trayIcon ??= await TrayIcon.getById(TRAY_ID);
  if (!trayIcon) {
    if (missingTrayRetryCount < 5) {
      missingTrayRetryCount += 1;
      setTimeout(() => queueTrayMenuRebuild(t), 250);
    } else {
      console.error(`[Tray] Could not find tray icon '${TRAY_ID}'.`);
    }
    return;
  }
  missingTrayRetryCount = 0;

  const state = useAppStore.getState();
  const items: TrayMenuItem[] = [
    {
      id: `tray-llm-current-${menuVersion}`,
      text: `LLM · ${getProviderLabel(state.llmProvider, t)} · ${state.llmModel}`,
      enabled: false,
    },
    {
      id: `tray-llm-picker-${menuVersion}`,
      text: `${t("settings.llm.provider")} / ${t("settings.llm.model")}`,
      items: buildProviderSubmenus(menuVersion, t),
    },
    { item: "Separator" },
    { id: "tray_open_settings", text: "設定" },
    { id: "tray_quit", text: "離開" },
  ];
  const nextMenu = await Menu.new({ id: `neuropen-tray-menu-${menuVersion}`, items });

  if (menuVersion !== rebuildVersion) {
    await nextMenu.close().catch(() => { });
    return;
  }

  try {
    await trayIcon.setMenu(nextMenu);
  } catch (error) {
    await nextMenu.close().catch(() => { });
    throw error;
  }

  const previousMenu = activeMenu;
  activeMenu = nextMenu;
  await previousMenu?.close().catch(() => { });
}

function queueTrayMenuRebuild(t?: Translate) {
  if (t) {
    latestTranslate = t;
  }
  if (!latestTranslate) {
    return Promise.resolve();
  }

  const requestVersion = ++rebuildVersion;
  const task = rebuildQueue.then(async () => {
    if (requestVersion !== rebuildVersion) {
      return;
    }
    await replaceTrayMenu(requestVersion);
  });
  rebuildQueue = task.catch((error) => {
    console.error("[Tray] Failed to rebuild LLM menu:", error);
  });
  return task;
}

async function refreshLocalModels(provider: LlmProvider) {
  const refreshVersion = (localRefreshVersions.get(provider) ?? 0) + 1;
  localRefreshVersions.set(provider, refreshVersion);
  const previousModels = localModelCatalogs.get(provider)?.models ?? [];
  localModelCatalogs.set(provider, { status: "loading", models: previousModels });
  void queueTrayMenuRebuild();

  const state = useAppStore.getState();
  const resolved = await resolveLlmProviderModelState(provider, {
    rememberedModel: state.llmSelectedModelByProvider[provider],
    modelOptions: state.llmModelOptionsByProvider[provider],
  });
  if (localRefreshVersions.get(provider) !== refreshVersion) {
    return;
  }

  if (resolved.discoveryStatus === "available") {
    localModelCatalogs.set(provider, {
      status: "available",
      models: resolved.nextOptions,
    });
  } else if (resolved.discoveryStatus === "empty") {
    localModelCatalogs.set(provider, { status: "empty", models: [] });
  } else {
    localModelCatalogs.set(provider, {
      status: "unavailable",
      models: previousModels,
      message: resolved.discoveryError,
    });
  }
  await queueTrayMenuRebuild();
}

export function useTrayLlmMenu() {
  const { language, t } = useI18n();
  const llmProvider = useAppStore((state) => state.llmProvider);
  const llmModel = useAppStore((state) => state.llmModel);
  const llmModelOptionsByProvider = useAppStore((state) => state.llmModelOptionsByProvider);
  const llmSelectedModelByProvider = useAppStore((state) => state.llmSelectedModelByProvider);
  const [hydrated, setHydrated] = useState(() => useAppStore.persist.hasHydrated());

  useEffect(() => {
    if (hydrated) {
      return undefined;
    }
    if (useAppStore.persist.hasHydrated()) {
      setHydrated(true);
      return undefined;
    }
    const unsubscribe = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [hydrated]);

  useEffect(() => {
    if (hydrated) {
      void queueTrayMenuRebuild(t);
    }
  }, [hydrated, language, llmModel, llmModelOptionsByProvider, llmProvider, llmSelectedModelByProvider, t]);
}
