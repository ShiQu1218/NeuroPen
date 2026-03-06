import type { useI18n } from "../../i18n";

interface SettingsTtsSectionProps {
  draftTtsPitch: string;
  draftTtsRate: string;
  draftTtsVoice: string;
  onPitchChange: (value: string) => void;
  onRateChange: (value: string) => void;
  onVoiceChange: (value: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsTtsSection({
  draftTtsPitch,
  draftTtsRate,
  draftTtsVoice,
  onPitchChange,
  onRateChange,
  onVoiceChange,
  t,
}: SettingsTtsSectionProps) {
  return (
    <>
      <div>
        <label className="text-xs font-medium">{t("settings.tts.voice")}</label>
        <input
          className="w-full input-field px-2.5 py-1.5 text-sm mt-1"
          placeholder="zh-TW-HsiaoChenNeural"
          value={draftTtsVoice}
          onChange={(event) => onVoiceChange(event.target.value)}
        />
        <p className="text-[11px] text-zinc-500 mt-0.5">{t("settings.tts.voiceHint")}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium">{t("settings.tts.rate")}</label>
          <input
            className="w-full input-field px-2.5 py-1.5 text-sm mt-1"
            placeholder="+0%"
            value={draftTtsRate}
            onChange={(event) => onRateChange(event.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium">{t("settings.tts.pitch")}</label>
          <input
            className="w-full input-field px-2.5 py-1.5 text-sm mt-1"
            placeholder="+0Hz"
            value={draftTtsPitch}
            onChange={(event) => onPitchChange(event.target.value)}
          />
        </div>
      </div>
    </>
  );
}
