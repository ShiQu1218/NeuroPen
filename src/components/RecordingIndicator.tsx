/**
 * Recording Indicator
 *
 * Phase 2 implementation:
 * - Floating overlay shown during voice capture
 * - Listens to `stt://start` and `stt://stop` Tauri events
 * - Displayed via a transparent, always-on-top, decoration-less window
 */
export default function RecordingIndicator() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="flex items-center gap-2 bg-black/70 text-white px-4 py-2 rounded-full text-sm">
        {/* TODO Phase 2: animate this dot when recording */}
        <span className="w-2 h-2 bg-red-500 rounded-full" />
        <span>錄音中…</span>
      </div>
    </div>
  );
}
