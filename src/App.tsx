import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import { useAppStore } from "./store/useAppStore";
import {
  applyThemePreference,
  getPersistedThemePreference,
  subscribeSystemThemeChanges,
} from "./theme";

// Each Tauri window renders through the same entry file, so lazy-load the
// window-specific UI to keep unrelated windows out of the initial bundle.
const MainWindowHost = lazy(() => import("./components/MainWindowHost"));
const PreviewWindow = lazy(() => import("./components/PreviewWindow"));
const QuickActionIcon = lazy(() => import("./components/QuickActionIcon"));
const Settings = lazy(() => import("./components/Settings"));
const RecordingIndicator = lazy(() => import("./components/RecordingIndicator"));
const ScreenshotOverlay = lazy(() => import("./components/ScreenshotOverlay"));

function useThemeController() {
  const themePreference = useAppStore((state) => state.themePreference);
  const [storeHydrated, setStoreHydrated] = useState(() => useAppStore.persist.hasHydrated());
  const effectiveThemePreference = storeHydrated ? themePreference : getPersistedThemePreference();

  useEffect(() => {
    if (storeHydrated) {
      return undefined;
    }
    const unsubscribe = useAppStore.persist.onFinishHydration(() => {
      setStoreHydrated(true);
    });
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [storeHydrated]);

  useEffect(() => {
    applyThemePreference(effectiveThemePreference);
    return subscribeSystemThemeChanges(() => {
      if (effectiveThemePreference === "system") {
        applyThemePreference("system");
      }
    });
  }, [effectiveThemePreference]);
}

function App() {
  const [windowLabel] = useState(() => getCurrentWindow().label);
  useThemeController();

  let content: ReactNode = null;
  switch (windowLabel) {
    case "main":
      content = <MainWindowHost />;
      break;
    case "preview":
      content = <PreviewWindow />;
      break;
    case "quick-action":
      content = <QuickActionIcon />;
      break;
    case "settings":
      content = <Settings />;
      break;
    case "recording-indicator":
      content = <RecordingIndicator />;
      break;
    case "screenshot-overlay":
      content = <ScreenshotOverlay />;
      break;
    default:
      content = null;
      break;
  }

  return <Suspense fallback={null}>{content}</Suspense>;
}

export default App;
