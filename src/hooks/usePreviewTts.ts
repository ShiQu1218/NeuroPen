import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef } from "react";
import { useAppStore } from "../store/useAppStore";

const parseRate = (value?: string | null) => {
  if (!value) return 1;
  const match = value.match(/([+-]?\d+(?:\.\d+)?)%/);
  if (!match) return 1;
  return Math.min(10, Math.max(0.1, 1 + Number(match[1]) / 100));
};

const parsePitch = (value?: string | null) => {
  if (!value) return 1;
  const match = value.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match) return 1;
  return Math.min(2, Math.max(0, 1 + Number(match[1]) / 100));
};

export function usePreviewTts(llmOutput: string) {
  const isTtsPlaying = useAppStore((state) => state.isTtsPlaying);
  const setIsTtsPlaying = useAppStore((state) => state.setIsTtsPlaying);
  const setLlmError = useAppStore((state) => state.setLlmError);
  const fallbackUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const fallbackTtsActiveRef = useRef(false);

  const stopFallbackTts = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    fallbackUtteranceRef.current = null;
    fallbackTtsActiveRef.current = false;
    setIsTtsPlaying(false);
  }, [setIsTtsPlaying]);

  const speakWithFallback = useCallback(
    async (text: string, voice?: string | null, rate?: string | null, pitch?: string | null) => {
      try {
        fallbackTtsActiveRef.current = false;
        await invoke("tts_speak", {
          text,
          voice: voice || null,
          rate: rate || null,
          pitch: pitch || null,
        });
      } catch (err) {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          setLlmError(`TTS 失敗：${String(err)}`);
          setIsTtsPlaying(false);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        if (voice) {
          const targetVoice = window.speechSynthesis
            .getVoices()
            .find((candidate) => candidate.name === voice || candidate.voiceURI === voice);
          if (targetVoice) {
            utterance.voice = targetVoice;
          }
        }
        utterance.rate = parseRate(rate);
        utterance.pitch = parsePitch(pitch);
        utterance.onend = () => {
          fallbackTtsActiveRef.current = false;
          fallbackUtteranceRef.current = null;
          setIsTtsPlaying(false);
        };
        utterance.onerror = () => {
          fallbackTtsActiveRef.current = false;
          fallbackUtteranceRef.current = null;
          setIsTtsPlaying(false);
          setLlmError("TTS 播放失敗");
        };
        fallbackUtteranceRef.current = utterance;
        fallbackTtsActiveRef.current = true;
        setIsTtsPlaying(true);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    },
    [setIsTtsPlaying, setLlmError]
  );

  const handleTtsToggle = useCallback(async () => {
    if (isTtsPlaying) {
      if (fallbackTtsActiveRef.current) {
        stopFallbackTts();
      } else {
        await invoke("tts_stop").catch(() => { });
      }
      return;
    }

    if (!llmOutput.trim()) {
      return;
    }

    const state = useAppStore.getState();
    await speakWithFallback(
      llmOutput,
      state.ttsVoice || null,
      state.ttsRate || null,
      state.ttsPitch || null
    );
  }, [isTtsPlaying, llmOutput, speakWithFallback, stopFallbackTts]);

  return {
    fallbackTtsActiveRef,
    handleTtsToggle,
    isTtsPlaying,
    stopFallbackTts,
  };
}
