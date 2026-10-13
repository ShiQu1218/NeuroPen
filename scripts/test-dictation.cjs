const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const compile = (filename) => ts.transpileModule(
  fs.readFileSync(filename, "utf8").replaceAll("import.meta.env.DEV", "false"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

// Use the existing TypeScript dependency; no test runner or browser is required.
require.extensions[".ts"] = (module, filename) => module._compile(compile(filename), filename);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Expected recording lifecycle transition did not occur");
}

async function controllerHarness(mode = "hold", overrides = {}) {
  const listeners = new Map();
  const calls = { start: 0, stop: 0, cancel: 0, restored: [] };
  const state = {
    recordingMode: mode, sttEnabled: true, selectionEnabled: true,
    sttEngine: "openAi", sttModelPath: "gpt-transcribe", sttLanguage: "auto",
    isRecording: false, language: "zh-TW",
    resetSession() {}, setCurrentMode() {}, setSelectedText() {},
    setIsRecording(value) { state.isRecording = value; },
    setSttError(value) { state.sttError = value; },
  };
  const service = {
    hasSttApiKey: async () => true,
    startRecording: async () => { calls.start++; await overrides.start?.(); },
    stopRecording: async () => { calls.stop++; await overrides.stop?.(); },
    cancelRecording: async () => { calls.cancel++; await overrides.cancel?.(); },
    setActiveFocusSession() {},
    restoreClipboard: async (id) => { calls.restored.push(id); },
  };
  const store = Object.assign((selector) => selector(state), { getState: () => state });
  let setup;
  let takeFocusSessionId;
  const mocks = {
    react: { useEffect: (fn) => { setup = fn; }, useRef: (value) => ({ current: value }), useState: () => ["", () => {}] },
    "@tauri-apps/api/webviewWindow": { WebviewWindow: { getByLabel: async () => null } },
    "@tauri-apps/api/event": {
      listen: async (event, handler) => { listeners.set(event, handler); return () => listeners.delete(event); },
      emit: async () => {},
    },
    "../i18n": { useI18n: () => ({ t: (key) => key }) },
    "../store/useAppStore": { useAppStore: store, resolveSttModelReference: (_, value) => value },
    "../services/mainWindowService": { mainWindowService: service },
    "../utils/previewWindow": {},
    "../utils/appText": { normalizeSttEngine: (value) => value, normalizeSttLanguage: (value) => value },
    "../utils/preferenceLearning": {},
    "./mainWindow/controllerHelpers": {
      initializeMainWindowRuntime: async () => {}, createSelectionListenerState: () => ({}),
      cleanupSelectionListenerState() {}, applySettingsSavedPayload() {},
    },
    "./mainWindow/selectionListeners": { registerSelectionListeners: async () => {} },
    "./mainWindow/screenshotListeners": { registerScreenshotListeners: async () => {} },
    "./mainWindow/sttFinalRouter": {
      registerSttFinalRouter: async (params) => { takeFocusSessionId = params.takeFocusSessionId; },
    },
  };
  const filename = path.join(root, "src/hooks/useMainWindowController.ts");
  const module = { exports: {} };
  vm.runInNewContext(compile(filename), {
    module, exports: module.exports, require: (id) => {
      if (!(id in mocks)) throw new Error(`Unexpected controller dependency: ${id}`);
      return mocks[id];
    }, console, setTimeout: () => 0, clearTimeout() {},
  }, { filename });
  module.exports.useMainWindowController();
  const cleanup = setup();
  await until(() => listeners.has("neuropen://undo-result"));
  return {
    calls, state, cleanup, takeFocusSessionId: () => takeFocusSessionId(),
    event: (name, payload = {}) => listeners.get(name)({ payload }),
    press: (sessionId = 42) => listeners.get("neuropen://mode-start")({
      payload: { has_selection: false, selected_text: null, sessionId },
    }),
    release: () => listeners.get("neuropen://hotkey-release")({ payload: {} }),
  };
}

test("hold stops on release and retains the original injection target", async () => {
  const h = await controllerHarness();
  await h.press();
  assert.equal(h.state.isRecording, true);
  await h.release();
  assert.equal(h.calls.stop, 1);
  assert.equal(h.state.isRecording, false);
  assert.equal(h.takeFocusSessionId(), 42);
  h.cleanup();
});

test("hands-free ignores release and key repeat, then finishes on a new press", async () => {
  const h = await controllerHarness("toggle");
  await h.press();
  await h.event("neuropen://recording-press");
  assert.equal(h.calls.stop, 0);
  await h.release();
  assert.equal(h.state.isRecording, true);
  await h.event("neuropen://recording-press");
  assert.equal(h.calls.start, 1);
  assert.equal(h.calls.stop, 1);
  assert.equal(h.takeFocusSessionId(), 42);
  h.cleanup();
});

test("a release during slow hold startup stops as soon as capture is ready", async () => {
  const startup = deferred();
  const h = await controllerHarness("hold", { start: () => startup.promise });
  const starting = h.press();
  await until(() => h.calls.start === 1);
  await h.release();
  startup.resolve();
  await starting;
  assert.equal(h.calls.stop, 1);
  assert.equal(h.state.isRecording, false);
  h.cleanup();
});

test("hands-free stays active after release during slow device startup", async () => {
  const startup = deferred();
  const h = await controllerHarness("toggle", { start: () => startup.promise });
  const starting = h.press();
  await until(() => h.calls.start === 1);
  await h.release();
  startup.resolve();
  await starting;
  assert.equal(h.calls.stop, 0);
  assert.equal(h.state.isRecording, true);
  await h.event("neuropen://recording-finish");
  assert.equal(h.calls.stop, 1);
  h.cleanup();
});

test("cancelling during startup discards audio and never queues a transcript", async () => {
  const startup = deferred();
  const h = await controllerHarness("toggle", { start: () => startup.promise });
  const starting = h.press();
  await until(() => h.calls.start === 1);
  await h.event("neuropen://recording-cancel");
  startup.resolve();
  await starting;
  assert.equal(h.calls.cancel, 1);
  assert.equal(h.calls.stop, 0);
  assert.equal(h.takeFocusSessionId(), undefined);
  assert.deepEqual(h.calls.restored, [42]);
  assert.equal(h.state.isRecording, false);
  h.cleanup();
});

test("cancellation restores the captured target and the next session can record", async () => {
  const h = await controllerHarness("toggle");
  await h.press(42);
  await h.release();
  await h.event("neuropen://recording-cancel");
  assert.equal(h.calls.stop, 0);
  assert.deepEqual(h.calls.restored, [42]);
  await h.press(99);
  await h.release();
  await h.event("neuropen://recording-finish");
  assert.equal(h.takeFocusSessionId(), 99);
  assert.equal(h.takeFocusSessionId(), undefined);
  h.cleanup();
});

test("failed cancellation is surfaced and allows finishing the recording", async () => {
  const h = await controllerHarness("toggle", { cancel: () => { throw new Error("cancel failed"); } });
  await h.press();
  await h.release();
  await h.event("neuropen://recording-cancel");
  assert.equal(h.state.isRecording, true);
  assert.match(h.state.sttError, /cancel failed/);
  await h.event("neuropen://recording-finish");
  assert.equal(h.calls.stop, 1);
  h.cleanup();
});

test("changing the preference during capture takes effect on the next session", async () => {
  const h = await controllerHarness("toggle");
  await h.press();
  h.state.recordingMode = "hold";
  await h.release();
  assert.equal(h.calls.stop, 0);
  await h.event("neuropen://recording-finish");
  await h.press(99);
  await h.release();
  assert.equal(h.calls.stop, 2);
  h.cleanup();
});

test("a second press during startup finishes once and overlapping finish/cancel cannot submit twice", async () => {
  const startup = deferred();
  const stopping = deferred();
  const h = await controllerHarness("toggle", { start: () => startup.promise, stop: () => stopping.promise });
  const starting = h.press();
  await until(() => h.calls.start === 1);
  await h.release();
  await h.press(99);
  startup.resolve();
  await until(() => h.calls.stop === 1);
  await h.event("neuropen://recording-finish");
  await h.event("neuropen://recording-cancel");
  stopping.resolve();
  await starting;
  assert.equal(h.calls.stop, 1);
  assert.equal(h.calls.cancel, 0);
  assert.equal(h.takeFocusSessionId(), 42);
  h.cleanup();
});

test("recording mode persists, survives reload, and runtime updates preserve another window's preference", () => {
  const storage = new Map();
  global.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  } };
  const filename = path.join(root, "src/store/useAppStore.ts");
  const freshStore = () => {
    delete require.cache[require.resolve(filename)];
    return require(filename).useAppStore;
  };
  const first = freshStore();
  assert.equal(first.getState().recordingMode, "hold");
  first.getState().setRecordingMode("toggle");
  assert.equal(JSON.parse(storage.get("neuropen-settings")).state.recordingMode, "toggle");
  const second = freshStore();
  assert.equal(second.getState().recordingMode, "toggle");
  second.getState().setRecordingMode("hold");
  first.getState().setIsRecording(true);
  first.getState().setThemePreference("dark");
  assert.equal(freshStore().getState().recordingMode, "hold");
  const saved = JSON.parse(storage.get("neuropen-settings"));
  saved.state.recordingMode = "invalid";
  storage.set("neuropen-settings", JSON.stringify(saved));
  assert.equal(freshStore().getState().recordingMode, "hold");
  window.localStorage.setItem = () => { throw new Error("storage full"); };
  assert.throws(() => first.getState().setRecordingMode("toggle"), /storage full/);
  delete global.window;
});
