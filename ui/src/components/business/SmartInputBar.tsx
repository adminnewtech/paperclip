import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import {
  Sparkles,
  Send,
  Loader2,
  X,
  CheckCircle2,
  AlertCircle,
  Camera,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "../../api/client";
import { useCompany } from "../../context/CompanyContext";
import { VoiceCommandButton } from "./VoiceCommandButton";
import { ReceiptScanner } from "./ReceiptScanner";
import type { OcrResult } from "../../hooks/useReceiptOCR";

type NlpIntent =
  | "create_invoice"
  | "create_expense"
  | "create_contact"
  | "create_deal"
  | "create_ticket"
  | "find_entity"
  | "show_report"
  | "unknown";

interface NlpCommandResult {
  intent: NlpIntent;
  entities: Record<string, unknown>;
  confidence: number;
  suggestedUrl?: string;
  preview?: string;
  mock?: boolean;
}

const INTENT_LABELS: Record<NlpIntent, string> = {
  create_invoice: "Create invoice",
  create_expense: "Record expense",
  create_contact: "Add contact",
  create_deal: "Create deal",
  create_ticket: "Open ticket",
  find_entity: "Search",
  show_report: "Show report",
  unknown: "Unknown",
};

function detectLang(text: string): "ar" | "en" {
  return /[؀-ۿ]/.test(text) ? "ar" : "en";
}

function appendEntitiesToUrl(
  url: string,
  entities: Record<string, unknown>,
): string {
  try {
    const isAbs = /^https?:\/\//i.test(url);
    const u = new URL(url, isAbs ? undefined : "http://x");
    for (const [key, value] of Object.entries(entities)) {
      if (value === undefined || value === null) continue;
      if (typeof value === "object") continue;
      if (u.searchParams.has(key)) continue;
      u.searchParams.set(key, String(value));
    }
    return isAbs ? u.toString() : `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

export interface SmartInputBarProps {
  className?: string;
  placeholder?: string;
}

/**
 * Top-of-page natural-language command bar. Supports typed text, voice
 * input (Web Speech API), and receipt OCR upload. Parsed commands show a
 * preview the user can confirm before navigating.
 */
export function SmartInputBar({
  className,
  placeholder = "أنشئ فاتورة لـ علي بـ 5000 ريال…",
}: SmartInputBarProps) {
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const [text, setText] = useState("");
  const [parseResult, setParseResult] = useState<NlpCommandResult | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const parseMutation = useMutation({
    mutationFn: async (input: { text: string; lang: "ar" | "en" }) => {
      if (!selectedCompanyId) throw new Error("No company selected");
      return api.post<NlpCommandResult>(
        `/companies/${selectedCompanyId}/business/nlp/parse-command`,
        input,
      );
    },
    onSuccess: (res) => setParseResult(res),
  });

  const runParse = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed || !selectedCompanyId) return;
      parseMutation.mutate({ text: trimmed, lang: detectLang(trimmed) });
    },
    [parseMutation, selectedCompanyId],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runParse(text);
  };

  const handleVoice = (transcript: string) => {
    setText(transcript);
    runParse(transcript);
  };

  const handleExecute = () => {
    if (!parseResult) return;
    if (parseResult.suggestedUrl) {
      const url = appendEntitiesToUrl(
        parseResult.suggestedUrl,
        parseResult.entities,
      );
      navigate(url);
    }
    setParseResult(null);
    setText("");
  };

  const handleCancel = () => {
    setParseResult(null);
  };

  const handleReceiptComplete = (_result: OcrResult) => {
    setShowScanner(false);
  };

  const confidence = parseResult
    ? Math.round(parseResult.confidence * 100)
    : 0;
  const confidenceTone =
    confidence >= 75
      ? "text-emerald-600 dark:text-emerald-400"
      : confidence >= 40
        ? "text-amber-600 dark:text-amber-400"
        : "text-destructive";

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardContent className="p-3 space-y-3">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium hidden sm:inline">
              Smart input
            </span>
          </div>
          <Input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            className="flex-1"
            disabled={parseMutation.isPending}
            dir="auto"
          />
          <VoiceCommandButton
            lang={detectLang(text || placeholder) === "ar" ? "ar-SA" : "en-US"}
            onTranscript={handleVoice}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Scan receipt"
            aria-label="Scan receipt"
            aria-pressed={showScanner}
            onClick={() => setShowScanner((v) => !v)}
          >
            <Camera className="h-4 w-4" />
          </Button>
          <Button
            type="submit"
            size="icon"
            disabled={!text.trim() || parseMutation.isPending}
            title="Submit command"
            aria-label="Submit command"
          >
            {parseMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>

        {parseMutation.isError && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>
              {parseMutation.error instanceof Error
                ? parseMutation.error.message
                : "Failed to parse command"}
            </span>
          </div>
        )}

        {parseResult && (
          <Card className="bg-muted/40">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {parseResult.intent === "unknown" ? (
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    )}
                    <span className="text-sm font-medium">
                      {INTENT_LABELS[parseResult.intent]}
                    </span>
                    <Badge variant="secondary" className={cn("text-[10px]", confidenceTone)}>
                      {confidence}% confidence
                    </Badge>
                    {parseResult.mock && (
                      <Badge variant="outline" className="text-[10px]">
                        mock
                      </Badge>
                    )}
                  </div>
                  {parseResult.preview && (
                    <div className="text-sm text-muted-foreground break-words" dir="auto">
                      {parseResult.preview}
                    </div>
                  )}
                  {Object.keys(parseResult.entities).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(parseResult.entities)
                        .filter(
                          ([, v]) =>
                            v !== undefined && v !== null && typeof v !== "object",
                        )
                        .map(([k, v]) => (
                          <Badge
                            key={k}
                            variant="outline"
                            className="text-[10px] font-normal"
                          >
                            <span className="text-muted-foreground">{k}:</span>{" "}
                            <span dir="auto">{String(v)}</span>
                          </Badge>
                        ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCancel}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleExecute}
                    disabled={
                      parseResult.intent === "unknown" || !parseResult.suggestedUrl
                    }
                  >
                    Execute
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {showScanner && (
          <div className="pt-1">
            <ReceiptScanner onCreateExpense={handleReceiptComplete} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
