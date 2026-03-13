interface SettingsToggleProps {
  checked: boolean;
  onChange: (nextValue: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export default function SettingsToggle({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: SettingsToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`settings-toggle ${checked ? "settings-toggle-on" : "settings-toggle-off"}`}
    >
      <span
        className={`settings-toggle-knob ${checked ? "settings-toggle-knob-on" : "settings-toggle-knob-off"}`}
      />
    </button>
  );
}
