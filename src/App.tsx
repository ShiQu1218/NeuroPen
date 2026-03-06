import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

import PreviewWindow from "./components/PreviewWindow";
import QuickActionIcon from "./components/QuickActionIcon";
import Settings from "./components/Settings";
import RecordingIndicator from "./components/RecordingIndicator";
import ScreenshotOverlay from "./components/ScreenshotOverlay";
import { useMainWindowController } from "./hooks/useMainWindowController";

function App() {
  const [windowLabel, setWindowLabel] = useState<string>("");

  useEffect(() => {
    setWindowLabel(getCurrentWindow().label);
  }, []);

  if (windowLabel === "main") {
    return <MainWindow />;
  }

  switch (windowLabel) {
    case "preview":
      return <PreviewWindow />;
    case "quick-action":
      return <QuickActionIcon />;
    case "settings":
      return <Settings />;
    case "recording-indicator":
      return <RecordingIndicator />;
    case "screenshot-overlay":
      return <ScreenshotOverlay />;
    default:
      return null;
  }
}

function MainWindow() {
  useMainWindowController();
  return null;
}

export default App;
