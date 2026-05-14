import { useCallback, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVoiceCommand } from "../../hooks/useVoiceCommand";

export interface VoiceCommandButtonProps {
  lang?: "ar-SA" | "ar-KW" | "en-US";
  /** Called when speech recognition completes with a final transcript. */
  onTranscript: (text: string) => void;
  /** Optional: while the user is speaking, get interim transcript updates. */
  onInterim?: (text: string) => void;
  className?: string;
  disabled?: boolean;
  size?: "default" | "sm" | "lg" | "icon";
  /**
   * If true, the button shows a tooltip-style transcript bubble while
   * actively listening. Default true.
   */
  showLivePreview?: boolean;
}

/**
 * Mic button with animated pulse when listening. Feature-detects the Web
 * Speech API; renders a disabled state with explanatory tooltip when
 * unavailable.
 */
export function VoiceCommandButton({
  lang = "ar-SA",
  onTranscript,
  onInterim,
  className,
  disabled,
  size = "icon",
  showLivePreview = true,
}: VoiceCommandButtonProps) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleResult = useCallback(
    (text: string) => {
      setErrorMsg(null);
      onTranscript(text);
    },
    [onTranscript],
  );

  const handleError = useCallback((code: string) => {
    setErrorMsg(code);
  }, []);

  const { isListening, isSupported, start, stop, transcript } = useVoiceCommand({
    lang,
    onResult: handleResult,
    onError: handleError,
  });

  // Bubble interim transcript up.
  if (onInterim && isListening && transcript) {
    onInterim(transcript);
  }

  const handleClick = () => {
    if (!isSupported) return;
    if (isListening) {
      stop();
    } else {
      setErrorMsg(null);
      start();
    }
  };

  const isDisabled = disabled || !isSupported;
  const title = !isSupported
    ? "Voice input not supported in this browser"
    : isListening
      ? "Click to stop"
      : "Click to speak";

  return (
    <div className={cn("relative inline-flex", className)}>
      <Button
        type="button"
        size={size}
        variant={isListening ? "default" : "outline"}
        onClick={handleClick}
        disabled={isDisabled}
        title={title}
        aria-label={title}
        aria-pressed={isListening}
        className={cn(
          "relative transition-colors",
          isListening && "bg-red-500 hover:bg-red-600 text-white border-red-500",
        )}
      >
        {isListening ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span
              aria-hidden
              className="absolute inset-0 rounded-md ring-2 ring-red-400/60 animate-pulse pointer-events-none"
            />
          </>
        ) : !isSupported ? (
          <MicOff className="h-4 w-4 opacity-60" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </Button>

      {showLivePreview && isListening && transcript && (
        <div
          className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-20 max-w-[20rem] min-w-[10rem] rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          role="status"
          aria-live="polite"
        >
          <div className="font-medium text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Listening…
          </div>
          <div className="break-words">{transcript}</div>
        </div>
      )}

      {errorMsg && !isListening && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-20 max-w-[18rem] rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive shadow-sm">
          Voice error: {errorMsg}
        </div>
      )}
    </div>
  );
}
