import { Suspense, lazy, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

// Each Tauri window renders through the same entry file, so lazy-load the
// window-specific UI to keep unrelated windows out of the initial bundle.
const MainWindowHost = lazy(() => import("./components/MainWindowHost"));
const PreviewWindow = lazy(() => import("./components/PreviewWindow"));
const QuickActionIcon = lazy(() => import("./components/QuickActionIcon"));
const Settings = lazy(() => import("./components/Settings"));
const LanguageVariantPickerWindow = lazy(() => import("./components/LanguageVariantPickerWindow"));
const RecordingIndicator = lazy(() => import("./components/RecordingIndicator"));
const ScreenshotOverlay = lazy(() => import("./components/ScreenshotOverlay"));

function App() {
  const [windowLabel] = useState(() => getCurrentWindow().label);

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
    case "language-variant-picker":
      content = <LanguageVariantPickerWindow />;
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
