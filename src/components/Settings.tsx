/**
 * Settings UI
 *
 * Phase 4 implementation:
 * - Hotkey configuration (default: Alt+`)
 * - Wake word setting (default: 助理)
 * - STT engine selector (OpenAI Whisper API / Local Whisper)
 * - Local model path (shown only when local engine selected and available)
 * - LLM output mode: DirectInject | PreviewStream
 * - OpenAI API key input — sent to Rust backend, never stored in localStorage
 * - Incognito mode toggle
 *
 * State is persisted via the Zustand store (localStorage), except API key
 * which is stored only in Rust process memory via the set_api_key command.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useAppStore } from "../store/useAppStore";

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
    localSttAvailable, setLocalSttAvailable,
    apiKeySet, setApiKeySet,
  } = useAppStore();

  // Local input state
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaveStatus, setApiKeySaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [hotkeyStatus, setHotkeyStatus] = useState<"" | "error">("");
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<"" | "saved" | "error">("");
  const [draftWakeWord, setDraftWakeWord] = useState(wakeWord);
  const [draftHotkey, setDraftHotkey] = useState(hotkey);
  const [draftSttEngine, setDraftSttEngine] = useState(sttEngine);
  const [draftOutputMode, setDraftOutputMode] = useState(outputMode);
  const [draftLlmProvider, setDraftLlmProvider] = useState(llmProvider);
  const [draftLlmModel, setDraftLlmModel] = useState(llmModel);

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
    if (draftLlmProvider !== "openAi" && draftSttEngine === "openAi") {
      setDraftSttEngine("local");
    }
  }, [draftLlmProvider, draftSttEngine]);

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

    try {
      if (draftHotkey !== hotkey) {
        await invoke("change_hotkey", { hotkeyStr: draftHotkey });
      }

      setWakeWord(nextWakeWord);
      setHotkey(draftHotkey);
      setSttEngine(draftSttEngine);
      setOutputMode(draftOutputMode);
      setLlmProvider(draftLlmProvider);
      setLlmModel(nextModel);
      await emit("talkflow://settings-saved", {
        wakeWord: nextWakeWord,
        hotkey: draftHotkey,
        sttEngine: draftSttEngine,
        outputMode: draftOutputMode,
        llmProvider: draftLlmProvider,
        llmModel: nextModel,
      });

      setHotkeyStatus("");
      setSettingsSaveStatus("saved");
      setTimeout(() => setSettingsSaveStatus(""), 2000);
    } catch (err) {
      console.error("[Settings] save settings failed:", err);
      setHotkeyStatus("error");
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
    setHotkeyStatus("");
    setSettingsSaveStatus("");
  };

  const hasSettingsChanges =
    draftWakeWord !== wakeWord ||
    draftHotkey !== hotkey ||
    draftSttEngine !== sttEngine ||
    draftOutputMode !== outputMode ||
    draftLlmProvider !== llmProvider ||
    draftLlmModel !== llmModel;

  return (
    <div className="p-6 space-y-5 text-sm text-gray-800">
      <h1 className="text-lg font-semibold">TalkFlow 設定</h1>

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
            // Ignore modifier-only presses
            if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

            const parts: string[] = [];
            if (e.ctrlKey) parts.push("Ctrl");
            if (e.altKey) parts.push("Alt");
            if (e.shiftKey) parts.push("Shift");
            if (e.metaKey) parts.push("Super");

            // Normalize key name
            let key = e.key;
            if (key === " ") key = "Space";
            else if (key.length === 1) key = key.toUpperCase();
            parts.push(key);

            const newHotkey = parts.join("+");
            setDraftHotkey(newHotkey);
            setHotkeyStatus("");
          }}
        />
        <p className="text-xs text-gray-400">點擊欄位後按下想要的快捷鍵組合，按「儲存」後生效。</p>
        {hotkeyStatus === "error" && (
          <p className="text-xs text-red-600">快捷鍵註冊失敗，請嘗試其他組合。</p>
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

      {/* Local model path — only when local engine is selected and available */}
      {draftSttEngine === "local" && localSttAvailable && (
        <div className="space-y-1">
          <label className="font-medium">本地模型路徑</label>
          <input
            className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400 font-mono text-xs"
            value={sttModelPath}
            onChange={(e) => setSttModelPath(e.target.value)}
            placeholder="C:\models\ggml-base.bin"
          />
          <p className="text-xs text-gray-400">
            從 huggingface.co/ggerganov/whisper.cpp 下載 GGML 格式模型檔。
          </p>
        </div>
      )}

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
          onChange={(e) => setDraftLlmProvider(e.target.value as "openAi" | "gemini" | "claude" | "grok")}
        >
          <option value="openAi">OpenAI</option>
          <option value="gemini">Gemini</option>
          <option value="claude">Claude</option>
          <option value="grok">Grok</option>
        </select>
      </div>
      <div className="space-y-1">
        <label className="font-medium">LLM Model</label>
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400 font-mono text-xs"
          value={draftLlmModel}
          onChange={(e) => setDraftLlmModel(e.target.value)}
          placeholder="e.g. gpt-4o-mini / gemini-1.5-pro / claude-3-5-sonnet-latest / grok-2-latest"
        />
      </div>

      {/* API Key — sent to Rust, never stored in localStorage */}
      <div className="space-y-1">
        <label className="font-medium">LLM / STT API Key</label>
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

      {/* Incognito */}
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
