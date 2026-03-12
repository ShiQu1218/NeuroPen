import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const I18N_DIR = path.join(ROOT_DIR, "src", "i18n");
const OUTPUT_BUNDLES_DIR = path.join(I18N_DIR, "locales", "bundles");

// The authoring files under src/i18n/messages + localeOverrides stay human-editable. This script
// flattens them into per-locale bundles so Vite can lazy-load one language at a time.

function extractExportedObject(source, exportName) {
  const exportToken = `export const ${exportName}`;
  const exportStart = source.indexOf(exportToken);

  if (exportStart === -1) {
    throw new Error(`Unable to find export "${exportName}"`);
  }

  const equalsIndex = source.indexOf("=", exportStart);
  const valueStart = source.indexOf("{", equalsIndex);

  if (equalsIndex === -1 || valueStart === -1) {
    throw new Error(`Unable to parse export "${exportName}"`);
  }

  let depth = 0;
  let inString = false;
  let stringDelimiter = "";
  let isEscaped = false;
  let valueEnd = -1;

  for (let index = valueStart; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === "\\") {
        isEscaped = true;
        continue;
      }

      if (char === stringDelimiter) {
        inString = false;
        stringDelimiter = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      stringDelimiter = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        valueEnd = index + 1;
        break;
      }
    }
  }

  if (valueEnd === -1) {
    throw new Error(`Unable to find end of export "${exportName}"`);
  }

  const literal = source.slice(valueStart, valueEnd);
  return vm.runInNewContext(`(${literal})`);
}

function writeJsonFile(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const settingsMessages = extractExportedObject(
  readFileSync(path.join(I18N_DIR, "messages", "settings.ts"), "utf8"),
  "settingsMessages",
);
const previewMessages = extractExportedObject(
  readFileSync(path.join(I18N_DIR, "messages", "preview.ts"), "utf8"),
  "previewMessages",
);
const historyMessages = extractExportedObject(
  readFileSync(path.join(I18N_DIR, "messages", "history.ts"), "utf8"),
  "historyMessages",
);
const commonMessages = extractExportedObject(
  readFileSync(path.join(I18N_DIR, "messages", "common.ts"), "utf8"),
  "commonMessages",
);
const localeOverrides = extractExportedObject(
  readFileSync(path.join(I18N_DIR, "localeOverrides.ts"), "utf8"),
  "localeOverrides",
);

mkdirSync(OUTPUT_BUNDLES_DIR, { recursive: true });

for (const language of Object.keys(settingsMessages)) {
  const mergedMessages = {
    ...settingsMessages[language],
    ...previewMessages[language],
    ...historyMessages[language],
    ...commonMessages[language],
  };

  writeJsonFile(path.join(OUTPUT_BUNDLES_DIR, `${language}.json`), {
    messages: mergedMessages,
    overrides: localeOverrides[language] ?? {},
  });
}
