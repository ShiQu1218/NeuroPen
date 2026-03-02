/**
 * Settings UI
 *
 * Phase 4 implementation:
 * - Hotkey configuration (default: Alt+`)
 * - Wake word setting (default: 助理)
 * - STT engine selector (OpenAI Whisper API / Local Whisper)
 * - Local STT model manager (install / delete / select active model)
 * - LLM output mode: DirectInject | PreviewStream
 * - OpenAI API key input — sent to Rust backend, never stored in localStorage
 * - Incognito mode toggle
 *
 * State is persisted via the Zustand store (localStorage), except API key
 * which is stored only in Rust process memory via the set_api_key command.
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useAppStore, type QuickActionCommand } from "../store/useAppStore";

interface LocalSttModel {
  id: string;
  name: string;
  description: string;
  speed: number;
  accuracy: number;
  downloadUrl: string;
  fileName: string;
  installed: boolean;
  active: boolean;
  modelPath: string;
}

type SettingsSection = "general" | "stt" | "quickAction" | "llm" | "privacy";

export default function Settings() {
  const {
    wakeWord, setWakeWord,
    sttModelPath, setSttModelPath,
    outputMode, setOutputMode,
    llmProvider, setLlmProvider,
    llmModel, setLlmModel,
    incognito, setIncognito,
    hotkey, setHotkey,
    sttEngine, setSttEngine,
    quickActionCommands, setQuickActionCommands,
    localSttAvailable, setLocalSttAvailable,
    apiKeySet, setApiKeySet,
  } = useAppStore();

  // Local input state
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaveStatus, setApiKeySaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [hotkeyStatus, setHotkeyStatus] = useState<"" | "error">("");
  const [hotkeyErrorMessage, setHotkeyErrorMessage] = useState("");
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<"" | "saved" | "error">("");
  const [draftWakeWord, setDraftWakeWord] = useState(wakeWord);
  const [draftHotkey, setDraftHotkey] = useState(hotkey);
  const [draftSttEngine, setDraftSttEngine] = useState(sttEngine);
  const [draftOutputMode, setDraftOutputMode] = useState(outputMode);
  const [draftLlmProvider, setDraftLlmProvider] = useState(llmProvider);
  const [draftLlmModel, setDraftLlmModel] = useState(llmModel);
  const [draftQuickActionCommands, setDraftQuickActionCommands] = useState<QuickActionCommand[]>(quickActionCommands);
  const [localModels, setLocalModels] = useState<LocalSttModel[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [localModelBusyId, setLocalModelBusyId] = useState("");
  const [localModelBusyAction, setLocalModelBusyAction] = useState<"" | "install" | "delete" | "select">("");
  const [localModelStatus, setLocalModelStatus] = useState<{ type: "" | "success" | "error"; message: string }>({
    type: "",
    message: "",
  });
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  // Query backend once on mount
  useEffect(() => {
    invoke<{ openAiAvailable: boolean; localAvailable: boolean }>("get_stt_capabilities")
      .then((caps) => setLocalSttAvailable(caps.localAvailable))
      .catch(() => setLocalSttAvailable(false));

    invoke<boolean>("has_api_key")
      .then((has) => setApiKeySet(has))
      .catch(() => setApiKeySet(false));
  }, []);

  useEffect(() => {
    setDraftWakeWord(wakeWord);
  }, [wakeWord]);

  useEffect(() => {
    setDraftHotkey(hotkey);
  }, [hotkey]);

  useEffect(() => {
    setDraftSttEngine(sttEngine);
  }, [sttEngine]);

  useEffect(() => {
    setDraftOutputMode(outputMode);
  }, [outputMode]);

  useEffect(() => {
    setDraftLlmProvider(llmProvider);
  }, [llmProvider]);

  useEffect(() => {
    setDraftLlmModel(llmModel);
  }, [llmModel]);

  useEffect(() => {
    setDraftQuickActionCommands(quickActionCommands);
  }, [quickActionCommands]);

  useEffect(() => {
    if (draftLlmProvider !== "openAi" && draftSttEngine === "openAi") {
      setDraftSttEngine("local");
    }
  }, [draftLlmProvider, draftSttEngine]);

  const loadLocalModels = useCallback(async () => {
    setLocalModelsLoading(true);
    try {
      const models = await invoke<LocalSttModel[]>("list_local_stt_models");
      setLocalModels(models);
    } catch (err) {
      console.error("[Settings] list_local_stt_models failed:", err);
      setLocalModelStatus({ type: "error", message: "無法讀取本地 STT 模型清單" });
    } finally {
      setLocalModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLocalModels();
  }, [loadLocalModels]);

  const handleSaveApiKey = () => {
    setApiKeySaveStatus("saving");
    invoke("set_api_key", { key: apiKeyInput })
      .then(() => {
        setApiKeySet(apiKeyInput.length > 0);
        setApiKeyInput("");
        setApiKeySaveStatus("saved");
        setTimeout(() => setApiKeySaveStatus(""), 2000);
      })
      .catch(() => {
        setApiKeySaveStatus("error");
        setTimeout(() => setApiKeySaveStatus(""), 2000);
      });
  };

  const handleSaveSettings = async () => {
    const nextWakeWord = draftWakeWord.trim();
    const nextModel = draftLlmModel.trim();
    const nextQuickActionCommands = draftQuickActionCommands
      .map((command) => ({
        ...command,
        label: command.label.trim(),
        instruction: command.instruction.trim(),
      }))
      .filter((command) => command.label && command.instruction);
    if (!nextWakeWord) {
      setSettingsSaveStatus("error");
      setTimeout(() => setSettingsSaveStatus(""), 2000);
      return;
    }
    if (!nextModel) {
      setSettingsSaveStatus("error");
      setTimeout(() => setSettingsSaveStatus(""), 2000);
      return;
    }
    if (nextQuickActionCommands.length === 0) {
      setSettingsSaveStatus("error");
      setTimeout(() => setSettingsSaveStatus(""), 2000);
      return;
    }

    try {
      setHotkeyErrorMessage("");
      if (draftHotkey !== hotkey) {
        await invoke("change_hotkey", { hotkeyStr: draftHotkey });
      }

      setWakeWord(nextWakeWord);
      setHotkey(draftHotkey);
      setSttEngine(draftSttEngine);
      setOutputMode(draftOutputMode);
      setLlmProvider(draftLlmProvider);
      setLlmModel(nextModel);
      setQuickActionCommands(nextQuickActionCommands);
      await emit("talkflow://settings-saved", {
        wakeWord: nextWakeWord,
        hotkey: draftHotkey,
        sttEngine: draftSttEngine,
        sttModelPath,
        outputMode: draftOutputMode,
        llmProvider: draftLlmProvider,
        llmModel: nextModel,
        quickActionCommands: nextQuickActionCommands,
      });

      setHotkeyStatus("");
      setHotkeyErrorMessage("");
      setSettingsSaveStatus("saved");
      setTimeout(() => setSettingsSaveStatus(""), 2000);
    } catch (err) {
      console.error("[Settings] save settings failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      setHotkeyStatus("error");
      setHotkeyErrorMessage(message);
      setSettingsSaveStatus("error");
      setTimeout(() => setSettingsSaveStatus(""), 2000);
    }
  };

  const handleCancelSettings = () => {
    setDraftWakeWord(wakeWord);
    setDraftHotkey(hotkey);
    setDraftSttEngine(sttEngine);
    setDraftOutputMode(outputMode);
    setDraftLlmProvider(llmProvider);
    setDraftLlmModel(llmModel);
    setDraftQuickActionCommands(quickActionCommands);
    setHotkeyStatus("");
    setHotkeyErrorMessage("");
    setSettingsSaveStatus("");
  };

  const handleAddQuickActionCommand = () => {
    setDraftQuickActionCommands((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        label: "新指令",
        instruction: "",
      },
    ]);
  };

  const handleUpdateQuickActionCommand = (
    commandId: string,
    field: "label" | "instruction",
    value: string
  ) => {
    setDraftQuickActionCommands((prev) =>
      prev.map((command) =>
        command.id === commandId
          ? { ...command, [field]: value }
          : command
      )
    );
  };

  const handleDeleteQuickActionCommand = (commandId: string) => {
    setDraftQuickActionCommands((prev) =>
      prev.filter((command) => command.id !== commandId)
    );
  };

  const handleInstallLocalModel = async (modelId: string) => {
    setLocalModelBusyId(modelId);
    setLocalModelBusyAction("install");
    setLocalModelStatus({ type: "", message: "" });
    try {
      await invoke("install_local_stt_model", { modelId });
      await loadLocalModels();
      setLocalModelStatus({ type: "success", message: "模型安裝完成" });
    } catch (err) {
      console.error("[Settings] install_local_stt_model failed:", err);
      setLocalModelStatus({ type: "error", message: "模型安裝失敗，請稍後再試" });
    } finally {
      setLocalModelBusyId("");
      setLocalModelBusyAction("");
    }
  };

  const handleDeleteLocalModel = async (modelId: string) => {
    setLocalModelBusyId(modelId);
    setLocalModelBusyAction("delete");
    setLocalModelStatus({ type: "", message: "" });
    try {
      const deleting = localModels.find((model) => model.id === modelId);
      await invoke("delete_local_stt_model", { modelId });
      if (deleting && deleting.modelPath === sttModelPath) {
        setSttModelPath("");
        await emit("talkflow://settings-saved", {
          wakeWord: draftWakeWord.trim() || wakeWord,
          hotkey: draftHotkey,
          sttEngine: draftSttEngine,
          sttModelPath: "",
          outputMode: draftOutputMode,
          llmProvider: draftLlmProvider,
          llmModel: draftLlmModel.trim() || llmModel,
        });
      }
      await loadLocalModels();
      setLocalModelStatus({ type: "success", message: "模型已刪除" });
    } catch (err) {
      console.error("[Settings] delete_local_stt_model failed:", err);
      setLocalModelStatus({ type: "error", message: "模型刪除失敗，請稍後再試" });
    } finally {
      setLocalModelBusyId("");
      setLocalModelBusyAction("");
    }
  };

  const handleSelectLocalModel = async (modelId: string) => {
    setLocalModelBusyId(modelId);
    setLocalModelBusyAction("select");
    setLocalModelStatus({ type: "", message: "" });
    try {
      const selectedPath = await invoke<string>("select_local_stt_model", { modelId });
      setSttModelPath(selectedPath);
      await emit("talkflow://settings-saved", {
        wakeWord: draftWakeWord.trim() || wakeWord,
        hotkey: draftHotkey,
        sttEngine: draftSttEngine,
        sttModelPath: selectedPath,
        outputMode: draftOutputMode,
        llmProvider: draftLlmProvider,
        llmModel: draftLlmModel.trim() || llmModel,
      });
      await loadLocalModels();
      setLocalModelStatus({ type: "success", message: "已切換目前使用模型" });
    } catch (err) {
      console.error("[Settings] select_local_stt_model failed:", err);
      setLocalModelStatus({ type: "error", message: "模型切換失敗，請先確認已安裝" });
    } finally {
      setLocalModelBusyId("");
      setLocalModelBusyAction("");
    }
  };

  const hasSettingsChanges =
    draftWakeWord !== wakeWord ||
    draftHotkey !== hotkey ||
    draftSttEngine !== sttEngine ||
    draftOutputMode !== outputMode ||
    draftLlmProvider !== llmProvider ||
    draftLlmModel !== llmModel ||
    JSON.stringify(draftQuickActionCommands) !== JSON.stringify(quickActionCommands);

  return (
    <div className="p-6 space-y-5 text-sm text-gray-800">
      <h1 className="text-lg font-semibold">TalkFlow 設定</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[170px_minmax(0,1fr)]">
        <div className="rounded border border-gray-200 bg-gray-50 p-2">
          <p className="px-2 py-1 text-xs font-medium text-gray-500">設定目錄</p>
          <div className="space-y-1">
            <button
              onClick={() => setActiveSection("general")}
              className={`w-full rounded px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                activeSection === "general" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:bg-white"
              }`}
            >
              一般
            </button>
            <button
              onClick={() => setActiveSection("stt")}
              className={`w-full rounded px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                activeSection === "stt" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:bg-white"
              }`}
            >
              語音與 STT
            </button>
            <button
              onClick={() => setActiveSection("quickAction")}
              className={`w-full rounded px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                activeSection === "quickAction" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:bg-white"
              }`}
            >
              快捷指令
            </button>
            <button
              onClick={() => setActiveSection("llm")}
              className={`w-full rounded px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                activeSection === "llm" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:bg-white"
              }`}
            >
              LLM
            </button>
            <button
              onClick={() => setActiveSection("privacy")}
              className={`w-full rounded px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                activeSection === "privacy" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:bg-white"
              }`}
            >
              隱私
            </button>
          </div>
        </div>

        <div className="space-y-5">
          {activeSection === "general" && (
            <>
              {/* Hotkey */}
              <div className="space-y-1">
                <label className="font-medium">全域熱鍵</label>
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400"
                  value={draftHotkey}
                  readOnly
                  placeholder="按下快捷鍵組合…"
                  onKeyDown={(e) => {
                    e.preventDefault();
                    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

                    const parts: string[] = [];
                    if (e.ctrlKey) parts.push("Ctrl");
                    if (e.altKey) parts.push("Alt");
                    if (e.shiftKey) parts.push("Shift");
                    if (e.metaKey) parts.push("Super");

                    let key = e.key;
                    if (e.code === "Backquote" || key === "Dead") key = "Backquote";
                    else if (key === " ") key = "Space";
                    else if (key.length === 1) key = key.toUpperCase();
                    parts.push(key);

                    setDraftHotkey(parts.join("+"));
                    setHotkeyStatus("");
                    setHotkeyErrorMessage("");
                  }}
                />
                <p className="text-xs text-gray-400">點擊欄位後按下想要的快捷鍵組合，按「儲存」後生效。</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftHotkey("Alt+Backquote");
                      setHotkeyStatus("");
                      setHotkeyErrorMessage("");
                    }}
                    className="px-2 py-1 rounded text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    設回預設 Alt+`
                  </button>
                  <span className="text-xs text-gray-400">若按鍵擷取失敗可直接使用此按鈕。</span>
                </div>
                {hotkeyStatus === "error" && (
                  <p className="text-xs text-red-600">
                    {hotkeyErrorMessage
                      ? `快捷鍵註冊失敗：${hotkeyErrorMessage}`
                      : "快捷鍵註冊失敗，請嘗試其他組合。"}
                  </p>
                )}
              </div>

              {/* Wake word */}
              <div className="space-y-1">
                <label className="font-medium">喚醒詞</label>
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400"
                  value={draftWakeWord}
                  onChange={(e) => setDraftWakeWord(e.target.value)}
                  placeholder="助理"
                />
                <p className="text-xs text-gray-400">注意：變更喚醒詞可能導致誤觸發，請謹慎使用。</p>
              </div>
            </>
          )}

          {activeSection === "stt" && (
            <>
              {/* STT Engine selector */}
              <div className="space-y-1">
                <label className="font-medium">本地 STT 引擎選擇</label>
                {draftLlmProvider === "openAi" && (
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={draftSttEngine === "openAi"}
                      onChange={(e) => setDraftSttEngine(e.target.checked ? "openAi" : "local")}
                    />
                    使用 Whisper API（OpenAI）
                  </label>
                )}
                <div className="flex gap-4">
                  {draftLlmProvider === "openAi" && (
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="sttEngine"
                        value="openAi"
                        checked={draftSttEngine === "openAi"}
                        onChange={() => setDraftSttEngine("openAi")}
                      />
                      OpenAI Whisper API
                    </label>
                  )}
                  <label className={`flex items-center gap-1.5 ${localSttAvailable ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}>
                    <input
                      type="radio"
                      name="sttEngine"
                      value="local"
                      checked={draftSttEngine === "local"}
                      onChange={() => localSttAvailable && setDraftSttEngine("local")}
                      disabled={!localSttAvailable}
                    />
                    本地 Whisper
                  </label>
                </div>
                {!localSttAvailable && (
                  <div className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <p className="font-medium">本地 Whisper 未啟用</p>
                    <p className="mt-0.5 text-amber-700">
                      需要安裝 CMake + MSVC，然後以
                      <code className="mx-1 font-mono bg-amber-100 px-1 rounded">cargo build --features local-stt</code>
                      重新建置。
                    </p>
                  </div>
                )}
              </div>

              {/* Local STT model manager */}
              <div className="space-y-1">
                <label className="font-medium">本地 STT 模型管理</label>
                <p className="text-xs text-gray-400">可同時安裝多個模型，但一次只能選擇一個使用。</p>
                {!localSttAvailable && (
                  <p className="text-xs text-amber-700">目前執行檔尚未啟用本地推論，但你可以先安裝模型。</p>
                )}
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {localModelsLoading && (
                    <div className="text-xs text-gray-500">載入模型清單中…</div>
                  )}
                  {!localModelsLoading && localModels.map((model) => {
                    const isBusy = localModelBusyId === model.id;
                    return (
                      <div key={model.id} className="rounded border border-gray-200 bg-gray-50 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm">{model.name}</p>
                            <p className="text-xs text-gray-500">{model.description}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            {model.active && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">使用中</span>
                            )}
                            {model.installed && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">已安裝</span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-[11px] text-gray-600">
                            <span className="w-10">速度</span>
                            <div className="flex gap-1">
                              {Array.from({ length: 5 }).map((_, idx) => (
                                <span
                                  key={`speed-${model.id}-${idx}`}
                                  className={`h-1.5 w-4 rounded ${idx < model.speed ? "bg-emerald-500" : "bg-gray-200"}`}
                                />
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-gray-600">
                            <span className="w-10">準確</span>
                            <div className="flex gap-1">
                              {Array.from({ length: 5 }).map((_, idx) => (
                                <span
                                  key={`accuracy-${model.id}-${idx}`}
                                  className={`h-1.5 w-4 rounded ${idx < model.accuracy ? "bg-blue-500" : "bg-gray-200"}`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {!model.installed ? (
                            <button
                              onClick={() => handleInstallLocalModel(model.id)}
                              disabled={!!localModelBusyId}
                              className="px-2.5 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              {isBusy && localModelBusyAction === "install" ? "安裝中…" : "安裝"}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleSelectLocalModel(model.id)}
                                disabled={!!localModelBusyId || model.active}
                                className="px-2.5 py-1 rounded text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {isBusy && localModelBusyAction === "select" ? "切換中…" : model.active ? "目前使用" : "設為使用"}
                              </button>
                              <button
                                onClick={() => handleDeleteLocalModel(model.id)}
                                disabled={!!localModelBusyId}
                                className="px-2.5 py-1 rounded text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {isBusy && localModelBusyAction === "delete" ? "刪除中…" : "刪除"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {localModelStatus.type === "success" && (
                  <p className="text-xs text-green-600">{localModelStatus.message}</p>
                )}
                {localModelStatus.type === "error" && (
                  <p className="text-xs text-red-600">{localModelStatus.message}</p>
                )}
              </div>
            </>
          )}

          {activeSection === "quickAction" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="font-medium">Quick Action 快捷指令</label>
                  <p className="text-xs text-gray-400">可新增、編輯、刪除。原有四個已作為預設指令。</p>
                </div>
                <button
                  onClick={handleAddQuickActionCommand}
                  className="px-2.5 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
                >
                  新增指令
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                {draftQuickActionCommands.map((command) => (
                  <div key={command.id} className="rounded border border-gray-200 bg-gray-50 p-3 space-y-2">
                    <input
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-400"
                      value={command.label}
                      onChange={(e) => handleUpdateQuickActionCommand(command.id, "label", e.target.value)}
                      placeholder="按鈕名稱"
                    />
                    <textarea
                      className="w-full min-h-[72px] border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-400"
                      value={command.instruction}
                      onChange={(e) => handleUpdateQuickActionCommand(command.id, "instruction", e.target.value)}
                      placeholder="輸入此按鈕對 LLM 的指令內容"
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleDeleteQuickActionCommand(command.id)}
                        className="px-2.5 py-1 rounded text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 transition-colors"
                      >
                        刪除
                      </button>
                    </div>
                  </div>
                ))}
                {draftQuickActionCommands.length === 0 && (
                  <p className="text-xs text-amber-700">請至少新增一個快捷指令，否則無法儲存設定。</p>
                )}
              </div>
            </div>
          )}

          {activeSection === "llm" && (
            <>
              {/* Output mode */}
              <div className="space-y-1">
                <label className="font-medium">LLM 輸出模式</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="outputMode"
                      value="PreviewStream"
                      checked={draftOutputMode === "PreviewStream"}
                      onChange={() => setDraftOutputMode("PreviewStream")}
                    />
                    預覽串流
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="outputMode"
                      value="DirectInject"
                      checked={draftOutputMode === "DirectInject"}
                      onChange={() => setDraftOutputMode("DirectInject")}
                    />
                    直接注入
                  </label>
                </div>
              </div>

              {/* LLM Provider + Model */}
              <div className="space-y-1">
                <label className="font-medium">LLM API 提供商</label>
                <select
                  className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400"
                  value={draftLlmProvider}
                  onChange={(e) => setDraftLlmProvider(e.target.value as "openAi" | "gemini" | "claude" | "grok" | "ollama")}
                >
                  <option value="openAi">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="claude">Claude</option>
                  <option value="grok">Grok</option>
                  <option value="ollama">Ollama（本地）</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-medium">LLM Model</label>
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400 font-mono text-xs"
                  value={draftLlmModel}
                  onChange={(e) => setDraftLlmModel(e.target.value)}
                  placeholder="e.g. gpt-4o-mini / gemini-1.5-pro / claude-3-5-sonnet-latest / grok-2-latest / llama3.2"
                />
              </div>

              {/* API Key — sent to Rust, never stored in localStorage */}
              <div className="space-y-1">
                <label className="font-medium">LLM / STT API Key</label>
                {draftLlmProvider === "ollama" && (
                  <p className="text-xs text-gray-500">使用 Ollama 不需要 API Key（本機 11434）。</p>
                )}
                {apiKeySet && (
                  <p className="text-xs text-green-600">API Key 已設定。重新輸入可覆蓋。</p>
                )}
                <div className="flex gap-2">
                  <input
                    type="password"
                    className="flex-1 border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400 font-mono text-xs"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={apiKeySet ? "••••••••" : "輸入對應提供商 API Key"}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && apiKeyInput) handleSaveApiKey();
                    }}
                  />
                  <button
                    onClick={handleSaveApiKey}
                    disabled={!apiKeyInput || apiKeySaveStatus === "saving"}
                    className="px-3 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {apiKeySaveStatus === "saving" ? "儲存中…" : "儲存"}
                  </button>
                </div>
                {apiKeySaveStatus === "saved" && (
                  <p className="text-xs text-green-600">已儲存至安全記憶體。</p>
                )}
                {apiKeySaveStatus === "error" && (
                  <p className="text-xs text-red-600">儲存失敗，請重試。</p>
                )}
              </div>
            </>
          )}

          {activeSection === "privacy" && (
            <div className="flex items-center gap-3">
              <label className="font-medium">隱私模式（不呼叫 LLM）</label>
              <button
                onClick={() => setIncognito(!incognito)}
                className={`relative w-10 h-5 rounded-full transition-colors ${incognito ? "bg-blue-500" : "bg-gray-300"}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${incognito ? "translate-x-5" : ""}`}
                />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="pt-2 flex items-center justify-end gap-2">
        {settingsSaveStatus === "saved" && (
          <p className="text-xs text-green-600">設定已套用。</p>
        )}
        {settingsSaveStatus === "error" && (
          <p className="text-xs text-red-600">儲存失敗，請確認喚醒詞與熱鍵設定。</p>
        )}
        <button
          onClick={handleCancelSettings}
          disabled={!hasSettingsChanges}
          className="px-3 py-1 rounded text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSaveSettings}
          disabled={!hasSettingsChanges}
          className="px-3 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          儲存
        </button>
      </div>
    </div>
  );
}
