interface SettingsInfoHintProps {
  text: string;
}

export default function SettingsInfoHint({ text }: SettingsInfoHintProps) {
  return (
    <span className="group relative inline-flex shrink-0" title={text}>
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-[10px] font-semibold text-zinc-500">
        i
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-56 -translate-x-1/2 rounded-xl bg-zinc-950 px-3 py-2 text-[11px] leading-5 text-white shadow-[0_14px_30px_rgba(15,23,42,0.28)] group-hover:block">
        {text}
      </span>
    </span>
  );
}
