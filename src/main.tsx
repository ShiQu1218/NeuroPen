import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getPersistedLanguage, initializeI18n } from "./i18n";
import { applyThemePreference, getPersistedThemePreference } from "./theme";

async function bootstrap() {
  try {
    applyThemePreference(getPersistedThemePreference());
  } catch (error) {
    console.error("Failed to initialize theme before first render.", error);
  }

  try {
    // The UI reads translations synchronously via t(), so preload the persisted locale before the
    // first render instead of flashing the fallback language and re-rendering immediately after.
    await initializeI18n(getPersistedLanguage());
  } catch (error) {
    console.error("Failed to initialize i18n bundles.", error);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
