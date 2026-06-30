import type { useI18n } from "../../i18n";
import type { QuickActionCommand } from "../../store/useAppStore";
import SettingsInfoHint from "./SettingsInfoHint";

interface SettingsQuickActionSectionProps {
  commands: QuickActionCommand[];
  commandsDirty: boolean;
  onAdd: () => void;
  onDelete: (commandId: string) => void;
  onMove: (commandId: string, direction: "up" | "down") => void;
  onUploadDocument: () => void;
  onUpdate: (commandId: string, field: "label" | "instruction", value: string) => void;
  onSave: () => void;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsQuickActionSection({
  commands,
  commandsDirty,
  onAdd,
  onDelete,
  onMove,
  onUploadDocument,
  onUpdate,
  onSave,
  t,
}: SettingsQuickActionSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="font-medium text-zinc-900">{t("settings.quickAction.label")}</label>
          <SettingsInfoHint text={t("settings.quickAction.hint")} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={!commandsDirty}
            className="btn-primary px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {t("settings.save")}
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {t("settings.quickAction.add")}
          </button>
          <button
            type="button"
            onClick={onUploadDocument}
            className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48" />
            </svg>
            {t("quickAction.uploadDocument")}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {commands.map((command, index) => {
          const retainedAttachmentCount = command.attachments?.length ?? 0;
          const isDocumentCommand = command.action === "documentUpload" || retainedAttachmentCount > 0;
          return (
            <div key={command.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                  {isDocumentCommand ? t("settings.quickAction.typeDocument") : t("settings.quickAction.typePrompt")}
                </span>
                <input
                  className="w-full input-field px-2 py-1 text-xs"
                  value={command.label}
                  onChange={(event) => onUpdate(command.id, "label", event.target.value)}
                  placeholder={t("settings.quickAction.namePlaceholder")}
                />
              </div>
              {isDocumentCommand && (
                <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
                  {t("settings.quickAction.documentHint")}
                  {retainedAttachmentCount > 0 ? ` (${retainedAttachmentCount})` : ""}
                </p>
              )}
              <textarea
                className="w-full min-h-[72px] input-field px-2 py-1 text-xs"
                value={command.instruction}
                onChange={(event) => onUpdate(command.id, "instruction", event.target.value)}
                placeholder={t("settings.quickAction.instructionPlaceholder")}
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={() => onMove(command.id, "up")}
                  disabled={index === 0}
                  className="btn-secondary px-2.5 py-1 rounded-lg text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  title={t("settings.quickAction.moveUp")}
                >
                  ↑
                </button>
                <button
                  onClick={() => onMove(command.id, "down")}
                  disabled={index === commands.length - 1}
                  className="btn-secondary px-2.5 py-1 rounded-lg text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  title={t("settings.quickAction.moveDown")}
                >
                  ↓
                </button>
                <button
                  onClick={() => onDelete(command.id)}
                  className="btn-danger px-2.5 py-1 rounded-lg text-xs"
                >
                  {t("settings.stt.delete")}
                </button>
              </div>
            </div>
          );
        })}
        {commands.length === 0 && (
          <p className="text-xs text-amber-700">{t("settings.quickAction.requireOne")}</p>
        )}
      </div>
    </div>
  );
}
