import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Keyboard, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Barcode scanner component.
 *
 * Supports two input modes that work side by side:
 *
 *  1. USB HID scanner — the default. USB barcode guns behave as keyboards:
 *     they "type" each digit very quickly followed by Enter. We keep an
 *     always-focused hidden input plus a visible duplicate. As long as the
 *     POS page is open the next scan lands in that input automatically.
 *
 *     We also detect typing speed: characters that arrive within < 30ms of
 *     each other are treated as a scan even without Enter (some scanners
 *     omit the suffix). A short debounce window (50ms after the last char)
 *     emits the value.
 *
 *  2. Camera — opt-in. We try to dynamically import `@zxing/browser` (the
 *     standard open-source JS barcode lib). If the package isn't installed
 *     we show a clear message asking the user to install it and fall back
 *     to USB-only mode. The POS continues to work without camera support.
 *
 * The component never blocks the page if camera APIs are unavailable.
 */

export interface BarcodeScannerProps {
  /** Called whenever a barcode is captured (USB or camera). */
  onScan: (barcode: string) => void;
  /** Optional autofocus override. Defaults to true. */
  autoFocus?: boolean;
  placeholder?: string;
  /** Disable the input (e.g. while a scan is processing). */
  disabled?: boolean;
}

const FAST_TYPING_THRESHOLD_MS = 30;
const SCAN_COMMIT_DELAY_MS = 50;

// Type the optional zxing module to avoid a hard dependency at type-check time.
interface ZXingReader {
  decodeFromVideoDevice(
    deviceId: string | undefined,
    videoElement: HTMLVideoElement,
    callback: (result: { getText(): string } | undefined) => void,
  ): Promise<void> | void;
  reset?(): void;
}

interface ZXingModule {
  BrowserMultiFormatReader: new () => ZXingReader;
}

export function BarcodeScanner({
  onScan,
  autoFocus = true,
  placeholder = "Scan barcode or type SKU…",
  disabled = false,
}: BarcodeScannerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastKeystrokeRef = useRef<number>(0);
  const fastTypingRef = useRef<boolean>(false);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Keep the USB input focused. We re-focus on any blur except when the
  // camera modal is open or when the page is hidden.
  useEffect(() => {
    if (!autoFocus) return;
    const refocus = () => {
      if (cameraOpen) return;
      if (document.hidden) return;
      const el = inputRef.current;
      if (el && document.activeElement !== el && !disabled) {
        el.focus({ preventScroll: true });
      }
    };
    refocus();
    const id = setInterval(refocus, 500);
    return () => clearInterval(id);
  }, [autoFocus, cameraOpen, disabled]);

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      setValue("");
      fastTypingRef.current = false;
      onScan(trimmed);
    },
    [onScan],
  );

  // Detect fast typing → treat as a scan even without Enter.
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const now = performance.now();
    const delta = now - lastKeystrokeRef.current;
    lastKeystrokeRef.current = now;
    setValue(e.target.value);
    if (delta < FAST_TYPING_THRESHOLD_MS) fastTypingRef.current = true;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    if (fastTypingRef.current && e.target.value.length >= 4) {
      commitTimerRef.current = setTimeout(() => {
        commit(e.target.value);
      }, SCAN_COMMIT_DELAY_MS);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      commit(value);
    } else if (e.key === "Escape") {
      setValue("");
    }
  };

  // ----- Camera mode -----
  useEffect(() => {
    if (!cameraOpen) return;
    let reader: ZXingReader | null = null;
    let cancelled = false;
    (async () => {
      try {
        // Dynamic import so the dep is optional. If missing, surface a clear
        // installation hint instead of crashing the POS page.
        const dynImport = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
        const mod = (await dynImport("@zxing/browser").catch(() => null)) as
          | ZXingModule
          | null;
        if (!mod) {
          setCameraError(
            "Camera scanning requires @zxing/browser. Install it with `npm i @zxing/browser` to enable.",
          );
          return;
        }
        if (cancelled || !videoRef.current) return;
        reader = new mod.BrowserMultiFormatReader();
        await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!result) return;
          const text = result.getText();
          if (text) {
            commit(text);
            setCameraOpen(false);
          }
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to open camera";
        setCameraError(message);
      }
    })();
    return () => {
      cancelled = true;
      try {
        reader?.reset?.();
      } catch {
        // best-effort cleanup
      }
    };
  }, [cameraOpen, commit]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className="h-14 w-full rounded-md border border-input bg-transparent pl-10 pr-3 text-lg shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Barcode input"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-14 px-4"
          onClick={() => setCameraOpen((v) => !v)}
          title="Toggle camera scanner"
        >
          <Camera className="h-5 w-5" />
        </Button>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Keyboard className="h-3 w-3" />
        USB scanner ready. Connect a USB barcode reader or type the SKU and press Enter.
      </p>

      {cameraOpen && (
        <div className="relative overflow-hidden border border-border bg-black">
          <button
            type="button"
            onClick={() => setCameraOpen(false)}
            className="absolute right-2 top-2 z-10 inline-flex items-center justify-center bg-background/90 p-1"
            aria-label="Close camera"
          >
            <X className="h-4 w-4" />
          </button>
          {cameraError ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {cameraError}
            </div>
          ) : (
            <video
              ref={videoRef}
              className="aspect-video w-full"
              playsInline
              muted
            />
          )}
        </div>
      )}
    </div>
  );
}
