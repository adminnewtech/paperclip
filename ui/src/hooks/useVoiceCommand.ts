import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types — Web Speech API is not part of standard TS lib, so we declare a
// minimal interface locally. All access goes through feature detection.
// ---------------------------------------------------------------------------

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<{
    readonly isFinal: boolean;
    readonly length: number;
    readonly [index: number]: { readonly transcript: string };
  }>;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoiceCommandOptions {
  lang?: "ar-SA" | "ar-KW" | "en-US";
  continuous?: boolean;
  onResult: (text: string) => void;
  onError?: (error: string) => void;
  silenceTimeoutMs?: number;
}

export interface UseVoiceCommandResult {
  isListening: boolean;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
  transcript: string;
}

/**
 * Hook wrapping the browser Web Speech API. Feature-detects support — when
 * the API is unavailable, `isSupported` is false and start/stop are no-ops.
 *
 * Auto-stops after a configurable silence window (default 2.5s) once any
 * speech has been detected.
 */
export function useVoiceCommand(
  opts: UseVoiceCommandOptions,
): UseVoiceCommandResult {
  const {
    lang = "ar-SA",
    continuous = false,
    onResult,
    onError,
    silenceTimeoutMs = 2500,
  } = opts;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isSupported, setIsSupported] = useState<boolean>(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef<string>("");
  // Keep latest callbacks/lang/continuous in refs so we don't re-create
  // the recognition instance on every render.
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const langRef = useRef(lang);
  const continuousRef = useRef(continuous);
  const silenceTimeoutRef = useRef(silenceTimeoutMs);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    continuousRef.current = continuous;
  }, [continuous]);
  useEffect(() => {
    silenceTimeoutRef.current = silenceTimeoutMs;
  }, [silenceTimeoutMs]);

  useEffect(() => {
    setIsSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearSilenceTimer();
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
  }, [clearSilenceTimer]);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      onErrorRef.current?.("not_supported");
      return;
    }
    // Stop any existing instance first.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    let instance: SpeechRecognitionLike;
    try {
      instance = new Ctor();
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : "init_failed");
      return;
    }
    instance.lang = langRef.current;
    instance.continuous = continuousRef.current;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    finalTranscriptRef.current = "";
    setTranscript("");

    instance.onstart = () => {
      setIsListening(true);
    };

    instance.onresult = (event) => {
      let interim = "";
      let finalText = finalTranscriptRef.current;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) {
          finalText += alt.transcript;
        } else {
          interim += alt.transcript;
        }
      }
      finalTranscriptRef.current = finalText;
      setTranscript((finalText + interim).trim());

      // Reset silence timer
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        try {
          instance.stop();
        } catch {
          // ignore
        }
      }, silenceTimeoutRef.current);
    };

    instance.onerror = (event) => {
      const code = event.error || "unknown";
      // "no-speech" / "aborted" are not meaningful errors to bubble up.
      if (code !== "no-speech" && code !== "aborted") {
        onErrorRef.current?.(code);
      }
    };

    instance.onend = () => {
      clearSilenceTimer();
      setIsListening(false);
      const finalText = finalTranscriptRef.current.trim();
      if (finalText.length > 0) {
        onResultRef.current(finalText);
      }
      recognitionRef.current = null;
    };

    recognitionRef.current = instance;
    try {
      instance.start();
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : "start_failed");
      recognitionRef.current = null;
      setIsListening(false);
    }
  }, [clearSilenceTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSilenceTimer();
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, [clearSilenceTimer]);

  return {
    isListening,
    isSupported,
    start,
    stop,
    transcript,
  };
}
