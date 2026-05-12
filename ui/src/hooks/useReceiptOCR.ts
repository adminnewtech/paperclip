import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useCompany } from "../context/CompanyContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OcrExtracted {
  vendor?: string;
  date?: string;
  totalAmount?: number;
  currency?: string;
  vatAmount?: number;
  items?: Array<{ name: string; amount: number }>;
  category?: string;
}

export interface OcrResult {
  rawText: string;
  extracted: OcrExtracted;
  confidence: number;
}

export interface UseReceiptOCRResult {
  isProcessing: boolean;
  isReady: boolean;
  progress: number;
  error: string | null;
  scanReceipt: (file: File | Blob) => Promise<OcrResult>;
}

// Minimal subset of the tesseract.js API we rely on.
interface TesseractWorker {
  recognize(
    image: File | Blob | string,
  ): Promise<{
    data: {
      text: string;
      confidence?: number;
    };
  }>;
  terminate(): Promise<void>;
}

interface TesseractModule {
  createWorker(
    lang?: string | string[],
    oem?: number,
    opts?: {
      logger?: (m: { status?: string; progress?: number }) => void;
    },
  ): Promise<TesseractWorker>;
}

// ---------------------------------------------------------------------------
// Dynamic import — tesseract.js is optional. If not installed, scanReceipt
// rejects with a clear error explaining how to install it.
// ---------------------------------------------------------------------------

let cachedModule: TesseractModule | null | undefined;

async function loadTesseract(): Promise<TesseractModule | null> {
  if (cachedModule !== undefined) return cachedModule;
  if (typeof window === "undefined") {
    cachedModule = null;
    return null;
  }
  try {
    // Hide package name so the build does not statically resolve it
    // (it is an optional dependency).
    const pkg = "tesseract.js";
    const importer = Function(
      "p",
      "return import(p)",
    ) as (p: string) => Promise<unknown>;
    const mod = (await importer(pkg).catch(() => null)) as
      | { createWorker?: TesseractModule["createWorker"]; default?: TesseractModule }
      | null;
    if (!mod) {
      cachedModule = null;
      return null;
    }
    if (typeof mod.createWorker === "function") {
      cachedModule = { createWorker: mod.createWorker };
    } else if (mod.default && typeof mod.default.createWorker === "function") {
      cachedModule = mod.default;
    } else {
      cachedModule = null;
    }
    return cachedModule;
  } catch {
    cachedModule = null;
    return null;
  }
}

const MISSING_MESSAGE =
  "OCR requires tesseract.js — run `pnpm add tesseract.js` to enable receipt scanning.";

/**
 * Receipt OCR hook. Dynamically loads tesseract.js if available; otherwise
 * `scanReceipt` rejects with an actionable error message. After OCR, the
 * raw text is sent to the NLP extraction endpoint for structured fields.
 */
export function useReceiptOCR(): UseReceiptOCRResult {
  const { selectedCompanyId } = useCompany();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    // Feature-detect once on mount.
    let cancelled = false;
    loadTesseract().then((mod) => {
      if (!cancelled && aliveRef.current) {
        setIsReady(mod !== null);
      }
    });
    return () => {
      cancelled = true;
      aliveRef.current = false;
    };
  }, []);

  const scanReceipt = useCallback(
    async (file: File | Blob): Promise<OcrResult> => {
      if (!selectedCompanyId) {
        throw new Error("No company selected");
      }
      const mod = await loadTesseract();
      if (!mod) {
        const msg = MISSING_MESSAGE;
        setError(msg);
        throw new Error(msg);
      }

      setIsProcessing(true);
      setProgress(0);
      setError(null);

      let worker: TesseractWorker | null = null;
      try {
        worker = await mod.createWorker(["ara", "eng"], 1, {
          logger: (m) => {
            if (
              aliveRef.current &&
              m.status === "recognizing text" &&
              typeof m.progress === "number"
            ) {
              setProgress(Math.round(m.progress * 100));
            }
          },
        });
        const { data } = await worker.recognize(file);
        const rawText = data.text ?? "";
        const ocrConfidence =
          typeof data.confidence === "number" ? data.confidence / 100 : 0.5;

        // Call backend for LLM extraction (with mock fallback server-side).
        let extracted: OcrExtracted = {};
        let combinedConfidence = ocrConfidence;
        try {
          const res = await api.post<{
            vendor?: string;
            date?: string;
            totalAmount?: number;
            currency?: string;
            vatAmount?: number;
            items?: Array<{ name: string; amount: number }>;
            category?: string;
            confidence?: number;
          }>(
            `/companies/${selectedCompanyId}/business/nlp/extract-receipt`,
            { rawText },
          );
          extracted = {
            vendor: res.vendor,
            date: res.date,
            totalAmount: res.totalAmount,
            currency: res.currency,
            vatAmount: res.vatAmount,
            items: res.items,
            category: res.category,
          };
          if (typeof res.confidence === "number") {
            combinedConfidence = (ocrConfidence + res.confidence) / 2;
          }
        } catch {
          // Keep going with raw text only.
        }

        return {
          rawText,
          extracted,
          confidence: combinedConfidence,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "OCR failed";
        if (aliveRef.current) setError(msg);
        throw e;
      } finally {
        if (worker) {
          try {
            await worker.terminate();
          } catch {
            // ignore
          }
        }
        if (aliveRef.current) {
          setIsProcessing(false);
          setProgress(0);
        }
      }
    },
    [selectedCompanyId],
  );

  return { isProcessing, isReady, progress, error, scanReceipt };
}
