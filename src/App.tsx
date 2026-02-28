import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

import PreviewWindow from "./components/PreviewWindow";
import QuickActionIcon from "./components/QuickActionIcon";
import Settings from "./components/Settings";
import RecordingIndicator from "./components/RecordingIndicator";

function App() {
  const [windowLabel, setWindowLabel] = useState<string>("");

  useEffect(() => {
    setWindowLabel(getCurrentWindow().label);
  }, []);

  switch (windowLabel) {
    case "preview":
      return <PreviewWindow />;
    case "quick-action":
      return <QuickActionIcon />;
    case "settings":
      return <Settings />;
    case "recording-indicator":
      return <RecordingIndicator />;
    default:
      return (
        <main className="flex flex-col items-center justify-center h-screen bg-gray-50 text-gray-700">
          <h1 className="text-2xl font-semibold mb-2">TalkFlow</h1>
          <p className="text-gray-400 text-sm">Windows AI Voice Assistant</p>
          <p className="mt-4 text-xs text-gray-300">Press Alt+Space to start</p>
        </main>
      );
  }
}

export default App;
