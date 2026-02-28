/**
 * Settings UI
 *
 * Phase 4 implementation:
 * - Hotkey configuration (default: Alt+Space)
 * - Wake word setting (default: 助理)
 * - STT model path (Whisper .bin file)
 * - LLM output mode: DirectInject | PreviewStream
 * - OpenAI API key input
 * - Incognito mode toggle
 *
 * State is persisted via the Zustand store (localStorage).
 */
import { useAppStore } from "../store/useAppStore";

export default function Settings() {
  const {
    apiKey, setApiKey,
    wakeWord, setWakeWord,
    sttModelPath, setSttModelPath,
    outputMode, setOutputMode,
    incognito, setIncognito,
    hotkey, setHotkey,
  } = useAppStore();

  return (
    <div className="p-6 space-y-5 text-sm text-gray-800">
      <h1 className="text-lg font-semibold">TalkFlow 設定</h1>

      {/* Hotkey */}
      <div className="space-y-1">
        <label className="font-medium">全域熱鍵</label>
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400"
          value={hotkey}
          onChange={(e) => setHotkey(e.target.value)}
          placeholder="Alt+Space"
        />
      </div>

      {/* Wake word */}
      <div className="space-y-1">
        <label className="font-medium">喚醒詞</label>
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400"
          value={wakeWord}
          onChange={(e) => setWakeWord(e.target.value)}
          placeholder="助理"
        />
        <p className="text-xs text-gray-400">注意：變更喚醒詞可能導致誤觸發，請謹慎使用。</p>
      </div>

      {/* STT model path */}
      <div className="space-y-1">
        <label className="font-medium">Whisper 模型路徑</label>
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400 font-mono text-xs"
          value={sttModelPath}
          onChange={(e) => setSttModelPath(e.target.value)}
          placeholder="C:\models\ggml-base.bin"
        />
      </div>

      {/* Output mode */}
      <div className="space-y-1">
        <label className="font-medium">LLM 輸出模式</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="outputMode"
              value="PreviewStream"
              checked={outputMode === "PreviewStream"}
              onChange={() => setOutputMode("PreviewStream")}
            />
            預覽串流
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="outputMode"
              value="DirectInject"
              checked={outputMode === "DirectInject"}
              onChange={() => setOutputMode("DirectInject")}
            />
            直接注入
          </label>
        </div>
      </div>

      {/* API Key */}
      <div className="space-y-1">
        <label className="font-medium">OpenAI API Key</label>
        <input
          type="password"
          className="w-full border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-400 font-mono text-xs"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
        />
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
    </div>
  );
}
