import { useCallback, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "@/lib/router";
import {
  Camera,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useReceiptOCR, type OcrResult } from "../../hooks/useReceiptOCR";

export interface ReceiptScannerProps {
  /** Called when user clicks "Create Expense" after a successful scan. */
  onCreateExpense?: (result: OcrResult) => void;
  /** Optional: control whether to auto-navigate to finance on submit. */
  navigateOnCreate?: boolean;
  className?: string;
  compact?: boolean;
}

function formatAmount(n: number | undefined, currency?: string): string {
  if (n === undefined || Number.isNaN(n)) return "—";
  return `${n.toLocaleString()} ${currency ?? ""}`.trim();
}

/**
 * Drop zone + preview for OCR receipt scanning. Uses dynamically-imported
 * tesseract.js; renders a clear hint if the dependency is missing.
 */
export function ReceiptScanner({
  onCreateExpense,
  navigateOnCreate = true,
  className,
  compact = false,
}: ReceiptScannerProps) {
  const navigate = useNavigate();
  const { isProcessing, isReady, progress, error, scanReceipt } = useReceiptOCR();
  const [result, setResult] = useState<OcrResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setScanError(null);
      setResult(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      try {
        setPreviewUrl(URL.createObjectURL(file));
      } catch {
        setPreviewUrl(null);
      }
      try {
        const res = await scanReceipt(file);
        setResult(res);
      } catch (e) {
        setScanError(e instanceof Error ? e.message : "OCR failed");
      }
    },
    [scanReceipt, previewUrl],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setResult(null);
    setScanError(null);
  };

  const handleCreateExpense = () => {
    if (!result) return;
    onCreateExpense?.(result);
    if (navigateOnCreate) {
      const params = new URLSearchParams();
      params.set("action", "new-expense");
      if (result.extracted.vendor) params.set("vendor", result.extracted.vendor);
      if (result.extracted.totalAmount !== undefined)
        params.set("amount", String(result.extracted.totalAmount));
      if (result.extracted.currency)
        params.set("currency", result.extracted.currency);
      if (result.extracted.date) params.set("date", result.extracted.date);
      if (result.extracted.category)
        params.set("category", result.extracted.category);
      navigate(`/business/finance?${params.toString()}`);
    }
  };

  if (compact && !result && !isProcessing && !scanError) {
    return (
      <div className={cn("inline-flex", className)}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFileInput}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          title="Scan receipt"
          aria-label="Scan receipt"
        >
          <Camera className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleFileInput}
      />

      {!result && !isProcessing && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
            "hover:border-primary hover:bg-accent/30",
            isDragOver && "border-primary bg-accent/40",
            !isDragOver && "border-muted-foreground/30",
          )}
        >
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Upload className="h-8 w-8" />
            <div className="text-sm font-medium text-foreground">
              Drag receipt here or click to upload
            </div>
            <div className="text-xs">
              Images and PDFs · Arabic & English supported
            </div>
            {!isReady && (
              <div className="text-xs mt-2 text-amber-600 dark:text-amber-400">
                OCR engine not yet loaded — first scan may take a moment.
              </div>
            )}
          </div>
        </div>
      )}

      {isProcessing && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="flex-1">
                <div className="text-sm font-medium">Scanning receipt…</div>
                <div className="text-xs text-muted-foreground">
                  {progress > 0
                    ? `Recognizing text · ${progress}%`
                    : "Loading OCR engine"}
                </div>
                <div className="h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.max(5, progress)}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {scanError && !isProcessing && (
        <Card className="border-destructive/40">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-destructive">
                  OCR failed
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 break-words">
                  {scanError}
                </div>
                {error && error !== scanError && (
                  <div className="text-xs text-muted-foreground mt-1 break-words">
                    {error}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={reset}
                >
                  Try again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {result && !isProcessing && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <div className="font-medium text-sm">Receipt scanned</div>
                <Badge variant="secondary" className="text-[10px]">
                  {Math.round(result.confidence * 100)}% confidence
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={reset}
                aria-label="Discard scan"
                title="Discard"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Field label="Vendor" value={result.extracted.vendor ?? "—"} />
              <Field label="Date" value={result.extracted.date ?? "—"} />
              <Field
                label="Total"
                value={formatAmount(
                  result.extracted.totalAmount,
                  result.extracted.currency,
                )}
              />
              <Field
                label="VAT"
                value={formatAmount(
                  result.extracted.vatAmount,
                  result.extracted.currency,
                )}
              />
              <Field
                label="Category"
                value={result.extracted.category ?? "—"}
              />
              <Field
                label="Items"
                value={String(result.extracted.items?.length ?? 0)}
              />
            </div>

            {result.extracted.items && result.extracted.items.length > 0 && (
              <div className="mt-3 border rounded-md divide-y">
                {result.extracted.items.slice(0, 5).map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-1.5 text-xs"
                  >
                    <span className="truncate">{item.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatAmount(item.amount, result.extracted.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreateExpense}>
                <Receipt className="h-3.5 w-3.5" />
                Create Expense
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-medium text-foreground truncate">{value}</div>
    </div>
  );
}
