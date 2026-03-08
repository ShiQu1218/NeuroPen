import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { useI18n } from "../../i18n";

type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface SettingsUpdaterProps {
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsUpdater({ t }: SettingsUpdaterProps) {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [newVersion, setNewVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  const handleCheck = useCallback(async () => {
    setStatus("checking");
    setErrorMsg("");
    try {
      const update = await check();
      if (update) {
        setNewVersion(update.version);
        setChangelog(update.body ?? "");
        setPendingUpdate(update);
        setStatus("available");
      } else {
        setStatus("up-to-date");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const handleDownloadAndInstall = useCallback(async () => {
    if (!pendingUpdate) return;
    setStatus("downloading");
    try {
      let totalLen = 0;
      let downloadedLen = 0;
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalLen = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedLen += event.data.chunkLength;
          if (totalLen > 0) {
            setProgress(Math.round((downloadedLen / totalLen) * 100));
          }
        } else if (event.event === "Finished") {
          setStatus("ready");
        }
      });
      setStatus("ready");
      await relaunch();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [pendingUpdate]);

  // Auto-check on mount
  useEffect(() => {
    handleCheck();
  }, [handleCheck]);

  return (
    <div className="space-y-2">
      <label className="font-medium">{t("settings.updater.title")}</label>
      <p className="text-xs text-gray-400">
        {t("settings.updater.currentVersion")}: v{version}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary px-3 py-1 text-xs"
          disabled={status === "checking" || status === "downloading"}
          onClick={handleCheck}
        >
          {status === "checking"
            ? t("settings.updater.checking")
            : t("settings.updater.checkForUpdates")}
        </button>

        {status === "up-to-date" && (
          <span className="text-xs text-green-600">{t("settings.updater.upToDate")}</span>
        )}
      </div>

      {status === "error" && (
        <p className="text-xs text-red-600">
          {t("settings.updater.error", { reason: errorMsg })}
        </p>
      )}

      {(status === "available" || status === "downloading" || status === "ready") && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-sm font-medium text-blue-800">
            {t("settings.updater.available", { version: newVersion })}
          </p>

          {changelog && (
            <details className="text-xs text-gray-700">
              <summary className="cursor-pointer font-medium">
                {t("settings.updater.changelog")}
              </summary>
              <pre className="mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto text-[11px]">
                {changelog}
              </pre>
            </details>
          )}

          {status === "downloading" && (
            <div className="space-y-1">
              <p className="text-xs text-blue-700">
                {t("settings.updater.downloading", {
                  progress: String(progress),
                })}
              </p>
              <div className="h-2 w-full rounded bg-blue-100">
                <div
                  className="h-2 rounded bg-blue-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {status === "available" && (
            <button
              type="button"
              className="btn-primary px-3 py-1 text-xs"
              onClick={handleDownloadAndInstall}
            >
              {t("settings.updater.installAndRestart")}
            </button>
          )}

          {status === "ready" && (
            <p className="text-xs text-green-700">
              {t("settings.updater.readyToInstall")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
