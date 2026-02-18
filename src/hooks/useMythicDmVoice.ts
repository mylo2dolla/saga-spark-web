import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callEdgeFunctionRaw } from "@/lib/edge";

interface MythicDmVoiceSettings {
  enabled: boolean;
  rate: number;
  pitch: number;
  volume: number;
  voice: string;
}

const STORAGE_KEY = "mythic:dm-voice:v1";
const DEFAULT_SETTINGS: MythicDmVoiceSettings = {
  enabled: true,
  rate: 1,
  pitch: 1,
  volume: 0.85,
  voice: "alloy",
};

function loadSettings(): MythicDmVoiceSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<MythicDmVoiceSettings>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
      rate: Number.isFinite(parsed.rate) ? Number(parsed.rate) : DEFAULT_SETTINGS.rate,
      pitch: Number.isFinite(parsed.pitch) ? Number(parsed.pitch) : DEFAULT_SETTINGS.pitch,
      volume: Number.isFinite(parsed.volume) ? Number(parsed.volume) : DEFAULT_SETTINGS.volume,
      voice: typeof parsed.voice === "string" && parsed.voice.trim().length > 0 ? parsed.voice.trim() : DEFAULT_SETTINGS.voice,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

type TtsErrorPayload = { error?: string; message?: string; code?: string; requestId?: string };

export function useMythicDmVoice(campaignId?: string) {
  const [settings, setSettings] = useState<MythicDmVoiceSettings>(() => loadSettings());
  const [blocked, setBlocked] = useState(false);
  const [hasPreparedAudio, setHasPreparedAudio] = useState(false);
  const [lastError, setLastError] = useState<{ message: string; code?: string | null; requestId?: string | null } | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const browserTtsSupported = useMemo(
    () =>
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      "SpeechSynthesisUtterance" in window,
    [],
  );

  const audioSupported = useMemo(
    () => typeof window !== "undefined" && typeof Audio !== "undefined" && typeof Blob !== "undefined",
    [],
  );

  const supported = audioSupported || browserTtsSupported;

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const clearPreparedAudio = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        // ignore
      }
      audioRef.current = null;
    }

    if (audioUrlRef.current) {
      try {
        URL.revokeObjectURL(audioUrlRef.current);
      } catch {
        // ignore
      }
      audioUrlRef.current = null;
    }

    setHasPreparedAudio(false);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    clearPreparedAudio();
    setBlocked(false);
    setLastError(null);

    if (browserTtsSupported && typeof window !== "undefined") {
      window.speechSynthesis.cancel();
    }
  }, [browserTtsSupported, clearPreparedAudio]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  const setEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, enabled }));
    if (!enabled) {
      stop();
    }
  }, [stop]);

  const setRate = useCallback((rate: number) => {
    const safe = Math.max(0.5, Math.min(2, Number(rate) || 1));
    setSettings((prev) => ({ ...prev, rate: safe }));
  }, []);

  const setPitch = useCallback((pitch: number) => {
    const safe = Math.max(0.5, Math.min(2, Number(pitch) || 1));
    setSettings((prev) => ({ ...prev, pitch: safe }));
  }, []);

  const setVolume = useCallback((volume: number) => {
    const safe = Math.max(0, Math.min(1, Number(volume) || 1));
    setSettings((prev) => ({ ...prev, volume: safe }));
  }, []);

  const setVoice = useCallback((voice: string) => {
    const cleaned = voice.trim();
    if (!cleaned) return;
    setSettings((prev) => ({ ...prev, voice: cleaned }));
  }, []);

  const speakBrowser = useCallback((text: string, messageId: string | null, options?: { force?: boolean }) => {
    if (!browserTtsSupported || typeof window === "undefined") return false;
    const cleaned = text.trim();
    if (!cleaned) return false;
    if (!settings.enabled && !options?.force) return false;
    if (!options?.force && messageId && messageId === lastSpokenIdRef.current) return false;

    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;
    utterance.onstart = () => setBlocked(false);
    utterance.onerror = (event) => {
      const err = String((event as unknown as { error?: unknown }).error ?? "");
      if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-busy" || err === "synthesis-unavailable") {
        setBlocked(true);
      }
    };

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      if (messageId) lastSpokenIdRef.current = messageId;
      return true;
    } catch {
      setBlocked(true);
      return false;
    }
  }, [browserTtsSupported, settings.enabled, settings.pitch, settings.rate, settings.volume]);

  const speak = useCallback((text: string, messageId: string | null, options?: { force?: boolean }) => {
    const cleaned = text.trim();
    if (!supported || !cleaned) return false;
    if (!settings.enabled && !options?.force) return false;
    if (!options?.force && messageId && messageId === lastSpokenIdRef.current) return false;

    abortRef.current?.abort();
    abortRef.current = null;
    clearPreparedAudio();

    const shouldUseEdgeTts = Boolean(campaignId && audioSupported);
    if (!shouldUseEdgeTts) {
      return speakBrowser(cleaned, messageId, options);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const voice = settings.voice || "alloy";
    const effectiveMessageId = messageId ?? crypto.randomUUID();
    const idempotencyKey = `tts:${campaignId}:${effectiveMessageId}`;

    void (async () => {
      try {
        const response = await callEdgeFunctionRaw("mythic-tts", {
          requireAuth: true,
          signal: controller.signal,
          timeoutMs: 30_000,
          maxRetries: 0,
          idempotencyKey,
          body: {
            campaignId,
            messageId: effectiveMessageId,
            text: cleaned.slice(0, 2000),
            voice,
            format: "mp3",
          },
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as TtsErrorPayload;
          const code = typeof payload.code === "string" ? payload.code : null;
          const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
          const message = (typeof payload.message === "string" ? payload.message : null)
            ?? (typeof payload.error === "string" ? payload.error : null)
            ?? "TTS request failed";
          if (code === "openai_not_configured") {
            if (browserTtsSupported) {
              speakBrowser(cleaned, messageId, options);
              return;
            }
          }
          setLastError({ message, code, requestId });
          setBlocked(false);
          return;
        }

        const contentType = response.headers.get("Content-Type") ?? "audio/mpeg";
        const buffer = await response.arrayBuffer();
        if (controller.signal.aborted) return;

        const blob = new Blob([buffer], { type: contentType });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = settings.volume;
        audio.onended = () => {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
          if (audioUrlRef.current === url) audioUrlRef.current = null;
          if (audioRef.current === audio) audioRef.current = null;
          setHasPreparedAudio(false);
        };
        audio.onerror = () => {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
          if (audioUrlRef.current === url) audioUrlRef.current = null;
          if (audioRef.current === audio) audioRef.current = null;
          setHasPreparedAudio(false);
          setLastError({ message: "Audio playback failed.", code: "playback_error", requestId: null });
          setBlocked(false);
        };
        audioRef.current = audio;
        audioUrlRef.current = url;
        setHasPreparedAudio(true);
        setBlocked(false);
        setLastError(null);

        try {
          await audio.play();
          setBlocked(false);
          setLastError(null);
        } catch {
          // Autoplay policy block. Keep prepared audio so "Speak Latest" can resume.
          setBlocked(true);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "TTS request failed";
        setLastError({ message, code: "tts_request_failed", requestId: null });
        setBlocked(false);
      }
    })();

    if (messageId) lastSpokenIdRef.current = messageId;
    return true;
  }, [audioSupported, browserTtsSupported, campaignId, clearPreparedAudio, settings.enabled, settings.voice, settings.volume, speakBrowser, supported]);

  const resumeLatest = useCallback(async (): Promise<boolean> => {
    const audio = audioRef.current;
    if (!audio) return false;
    try {
      await audio.play();
      setBlocked(false);
      setLastError(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Playback blocked.";
      setLastError({ message, code: "playback_blocked", requestId: null });
      setBlocked(true);
      return false;
    }
  }, []);

  return {
    enabled: settings.enabled,
    setEnabled,
    rate: settings.rate,
    setRate,
    pitch: settings.pitch,
    setPitch,
    volume: settings.volume,
    setVolume,
    voice: settings.voice,
    setVoice,
    supported,
    blocked,
    hasPreparedAudio,
    lastError,
    speak,
    resumeLatest,
    stop,
  };
}
