import type { JSX, ReactNode } from "react";
import type { TranslationKey } from "../../i18n";
import type { SettingsSection } from "./settingsShared";

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  navItems: Array<{ id: SettingsSection; icon: JSX.Element }>;
  onSelectSection: (section: SettingsSection) => void;
  sectionLabelKey: Record<SettingsSection, TranslationKey>;
  t: (key: TranslationKey) => string;
  footer?: ReactNode;
}

export default function SettingsSidebar({
  activeSection,
  navItems,
  onSelectSection,
  sectionLabelKey,
  t,
  footer,
}: SettingsSidebarProps) {
  return (
    <div className="settings-shell-card flex h-full min-h-0 flex-col overflow-hidden p-3">
      <div className="px-2 pb-2">
        <p className="text-base font-semibold leading-tight text-zinc-900 dark:text-zinc-100">{t("settings.title")}</p>
      </div>
      <div className="flex-1 space-y-1.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelectSection(item.id)}
            className={
              activeSection === item.id
                ? "flex items-center gap-3 rounded-2xl bg-zinc-900 px-3 py-2.5 text-left text-sm font-medium text-white shadow-[0_12px_28px_rgba(24,24,27,0.16)] dark:bg-white dark:text-zinc-950"
                : "flex items-center gap-3 rounded-2xl border border-transparent bg-white/45 px-3 py-2.5 text-left text-sm font-medium text-zinc-600 transition hover:border-zinc-200 hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/40 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/80 dark:hover:text-zinc-100"
            }
          >
            <span className="flex items-center gap-3">
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                activeSection === item.id
                  ? "bg-white/14 text-white dark:bg-zinc-950/15 dark:text-zinc-950"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300"
              }`}>
                {item.icon}
              </span>
              <span>{t(sectionLabelKey[item.id])}</span>
            </span>
          </button>
        ))}
      </div>
      {footer ? (
        <div className="mt-3 border-t border-black/5 px-1 pt-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
