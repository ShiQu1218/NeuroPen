import type { useI18n } from "../../i18n";
import type { QuickActionCommand } from "../../store/useAppStore";

interface SettingsQuickActionSectionProps {
  commands: QuickActionCommand[];
  onAdd: () => void;
  onDelete: (commandId: string) => void;
  onMove: (commandId: string, direction: "up" | "down") => void;
  onUpdate: (commandId: string, field: "label" | "instruction", value: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsQuickActionSection({
  commands,
  onAdd,
  onDelete,
  onMove,
  onUpdate,
  t,
}: SettingsQuickActionSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label className="font-medium">{t("settings.quickAction.label")}</label>
          <p className="text-xs text-gray-400">{t("settings.quickAction.hint")}</p>
        </div>
        <button
          onClick={onAdd}
          className="btn-primary px-3 py-1.5 text-xs"
        >
          {t("settings.quickAction.add")}
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
        {commands.map((command, index) => (
          <div key={command.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <input
              className="w-full input-field px-2 py-1 text-xs"
              value={command.label}
              onChange={(event) => onUpdate(command.id, "label", event.target.value)}
              placeholder={t("settings.quickAction.namePlaceholder")}
            />
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
        ))}
        {commands.length === 0 && (
          <p className="text-xs text-amber-700">{t("settings.quickAction.requireOne")}</p>
        )}
      </div>
    </div>
  );
}
