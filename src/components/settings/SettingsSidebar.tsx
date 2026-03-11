import type { JSX } from "react";
import type { TranslationKey } from "../../i18n";
import type { SettingsSection } from "./settingsShared";

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  navItems: Array<{ id: SettingsSection; icon: JSX.Element }>;
  onSelectSection: (section: SettingsSection) => void;
  sectionLabelKey: Record<SettingsSection, TranslationKey>;
  t: (key: TranslationKey) => string;
}

export default function SettingsSidebar({
  activeSection,
  navItems,
  onSelectSection,
  sectionLabelKey,
  t,
}: SettingsSidebarProps) {
  return (
    <div className="self-start glass-panel-sm p-3 min-h-0 overflow-y-auto">
      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {t("settings.directory")}
      </p>
      <div className="mt-2 space-y-1.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelectSection(item.id)}
            className={
              activeSection === item.id
                ? "nav-tab-active flex items-center gap-3"
                : "nav-tab-inactive flex items-center gap-3"
            }
          >
            <span className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
                {item.icon}
              </span>
              <span>{t(sectionLabelKey[item.id])}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
