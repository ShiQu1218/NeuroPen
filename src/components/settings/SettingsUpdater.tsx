import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { useI18n } from "../../i18n";
import SettingsInfoHint from "./SettingsInfoHint";

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
  layout?: "content" | "rail";
}

export default function SettingsUpdater({ t, layout = "content" }: SettingsUpdaterProps) {
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

  const isRailLayout = layout === "rail";

  return (
    <div className={`flex flex-wrap gap-3 ${isRailLayout ? "rounded-[22px] border border-zinc-200 bg-white/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/70" : "items-center"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t("settings.updater.title")}</label>
          <SettingsInfoHint text={t("settings.updater.hint")} />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("settings.updater.currentVersion")}: v{version}
        </p>
      </div>
      <div className={`flex flex-wrap items-center gap-2 ${isRailLayout ? "w-full" : ""}`}>
        <button
          type="button"
          className={`btn-secondary px-3 py-2 text-xs ${isRailLayout ? "w-full justify-center" : ""}`}
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
        <p className="w-full text-xs text-red-600 dark:text-red-300">
          {t("settings.updater.error", { reason: errorMsg })}
        </p>
      )}

      {(status === "available" || status === "downloading" || status === "ready") && (
        <div className="w-full rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-900/70 dark:bg-blue-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              {t("settings.updater.available", { version: newVersion })}
            </p>
            {status === "available" && (
              <button
                type="button"
                className={`btn-primary px-3 py-2 text-xs ${isRailLayout ? "w-full justify-center" : ""}`}
                onClick={handleDownloadAndInstall}
              >
                {t("settings.updater.installAndRestart")}
              </button>
            )}
          </div>

          {(status === "downloading" || status === "ready") && (
            <div className="mt-2 space-y-1">
              {status === "downloading" && (
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {t("settings.updater.downloading", {
                    progress: String(progress),
                  })}
                </p>
              )}
              <div className="h-2 w-full rounded bg-blue-100">
                <div
                  className="h-2 rounded bg-blue-500 transition-all dark:bg-blue-400"
                  style={{ width: `${status === "ready" ? 100 : progress}%` }}
                />
              </div>
            </div>
          )}

          {status === "ready" && (
            <p className="mt-2 text-xs text-green-700 dark:text-green-300">
              {t("settings.updater.readyToInstall")}
            </p>
          )}

          {changelog && (
            <details className="mt-2 text-xs text-gray-700 dark:text-zinc-300">
              <summary className="cursor-pointer font-medium">
                {t("settings.updater.changelog")}
              </summary>
              <pre className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white/50 p-2 text-[11px] dark:bg-zinc-950/60">
                {changelog}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
