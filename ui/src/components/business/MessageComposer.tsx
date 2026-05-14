import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, Phone, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "../../context/CompanyContext";
import {
  businessMessagingApi,
  type MessageChannel,
  type SendMessageResult,
} from "../../api/business-messaging";
import { renderMessageTemplate, type MessageTemplate } from "@paperclipai/shared";

const COUNTRY_CODES: Array<{ code: string; label: string }> = [
  { code: "+965", label: "Kuwait (+965)" },
  { code: "+966", label: "Saudi Arabia (+966)" },
  { code: "+971", label: "UAE (+971)" },
  { code: "+974", label: "Qatar (+974)" },
  { code: "+973", label: "Bahrain (+973)" },
  { code: "+968", label: "Oman (+968)" },
  { code: "+20", label: "Egypt (+20)" },
  { code: "+962", label: "Jordan (+962)" },
  { code: "+961", label: "Lebanon (+961)" },
  { code: "+1", label: "USA / Canada (+1)" },
  { code: "+44", label: "UK (+44)" },
];

interface MessageComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRecipient?: string;
  defaultTemplate?: string;
  relatedEntityId?: string;
  lang?: "ar" | "en";
}

const CUSTOM_TEMPLATE_VALUE = "__custom__";

export function MessageComposer({
  open,
  onOpenChange,
  defaultRecipient,
  defaultTemplate,
  relatedEntityId,
  lang: defaultLang,
}: MessageComposerProps) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const [channel, setChannel] = useState<MessageChannel>("whatsapp");
  const [countryCode, setCountryCode] = useState<string>("+965");
  const [localNumber, setLocalNumber] = useState<string>("");
  const [templateKey, setTemplateKey] = useState<string>(
    defaultTemplate ?? CUSTOM_TEMPLATE_VALUE,
  );
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [customBody, setCustomBody] = useState<string>("");
  const [lang, setLang] = useState<"ar" | "en">(defaultLang ?? "en");
  const [result, setResult] = useState<SendMessageResult | null>(null);

  // Reset state whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setLang(defaultLang ?? "en");
    setTemplateKey(defaultTemplate ?? CUSTOM_TEMPLATE_VALUE);
    setVariables({});
    setCustomBody("");
    if (defaultRecipient) {
      // Try to split a "+CCXXXXXXXX" recipient into country code + local.
      const match = /^(\+\d{1,4})(.*)$/.exec(defaultRecipient.trim());
      if (match) {
        const matchedCode = COUNTRY_CODES.find((c) => c.code === match[1]);
        setCountryCode(matchedCode ? match[1]! : "+965");
        setLocalNumber((matchedCode ? match[2]! : defaultRecipient).trim());
      } else {
        setLocalNumber(defaultRecipient);
      }
    } else {
      setLocalNumber("");
    }
  }, [open, defaultRecipient, defaultTemplate, defaultLang]);

  const templatesQuery = useQuery({
    queryKey: ["business-messaging-templates", selectedCompanyId],
    queryFn: () => businessMessagingApi.listTemplates(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  const templates = templatesQuery.data?.templates ?? [];
  const selectedTemplate: MessageTemplate | undefined = useMemo(
    () =>
      templateKey === CUSTOM_TEMPLATE_VALUE
        ? undefined
        : templates.find((t) => t.key === templateKey),
    [templates, templateKey],
  );

  const previewBody = useMemo(() => {
    if (selectedTemplate) {
      const raw =
        lang === "ar" ? selectedTemplate.bodyAr : selectedTemplate.bodyEn;
      return renderMessageTemplate(raw, variables);
    }
    return customBody;
  }, [selectedTemplate, lang, variables, customBody]);

  const toPhone = `${countryCode}${localNumber.replace(/\D/g, "")}`;

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("No company selected");
      if (selectedTemplate) {
        return businessMessagingApi.sendTemplate(selectedCompanyId, {
          templateKey: selectedTemplate.key,
          channel,
          toPhone,
          variables,
          relatedEntityId,
          lang,
        });
      }
      return businessMessagingApi.send(selectedCompanyId, {
        channel,
        toPhone,
        body: customBody,
        relatedEntityId,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.ok) {
        void queryClient.invalidateQueries({
          queryKey: ["business-messaging-messages", selectedCompanyId],
        });
      }
    },
    onError: (err: Error) => {
      setResult({ ok: false, error: err.message });
    },
  });

  function setVariable(name: string, value: string) {
    setVariables((prev) => ({ ...prev, [name]: value }));
  }

  const canSend =
    !!selectedCompanyId &&
    localNumber.trim().length >= 4 &&
    previewBody.trim().length > 0 &&
    !sendMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Send message
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Channel toggle */}
          <div className="space-y-1.5">
            <Label className="text-xs">Channel</Label>
            <div className="flex items-center border rounded-md overflow-hidden w-fit">
              <button
                type="button"
                className={`px-3 py-1.5 text-sm transition-colors ${channel === "whatsapp" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "text-muted-foreground hover:bg-muted/50"}`}
                onClick={() => setChannel("whatsapp")}
              >
                WhatsApp
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-sm transition-colors ${channel === "sms" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "text-muted-foreground hover:bg-muted/50"}`}
                onClick={() => setChannel("sms")}
              >
                SMS
              </button>
            </div>
          </div>

          {/* Recipient */}
          <div className="space-y-1.5">
            <Label className="text-xs">Recipient phone</Label>
            <div className="flex items-center gap-2">
              <Select value={countryCode} onValueChange={setCountryCode}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_CODES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1">
                <Phone className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="50123456"
                  className="pl-8"
                  value={localNumber}
                  onChange={(e) => setLocalNumber(e.target.value)}
                  inputMode="tel"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Will send to{" "}
              <span className="font-mono">{toPhone || `${countryCode}…`}</span>
            </p>
          </div>

          {/* Template + Language */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Template</Label>
              <Select value={templateKey} onValueChange={setTemplateKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CUSTOM_TEMPLATE_VALUE}>
                    Custom message
                  </SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name} — {t.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Language</Label>
              <div className="flex items-center border rounded-md overflow-hidden">
                <button
                  type="button"
                  className={`px-3 py-1.5 text-sm ${lang === "en" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setLang("en")}
                >
                  EN
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 text-sm ${lang === "ar" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setLang("ar")}
                >
                  AR
                </button>
              </div>
            </div>
          </div>

          {/* Variable inputs */}
          {selectedTemplate && selectedTemplate.variables.length > 0 && (
            <div className="space-y-2 rounded-md border p-3 bg-muted/30">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Template variables
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {selectedTemplate.variables.map((v) => (
                  <div key={v} className="space-y-1">
                    <Label className="text-[10px]" htmlFor={`var-${v}`}>
                      {v}
                    </Label>
                    <Input
                      id={`var-${v}`}
                      placeholder={`{{${v}}}`}
                      value={variables[v] ?? ""}
                      onChange={(e) => setVariable(v, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom body */}
          {!selectedTemplate && (
            <div className="space-y-1.5">
              <Label className="text-xs">Message body</Label>
              <Textarea
                rows={5}
                placeholder="Type your message…"
                value={customBody}
                onChange={(e) => setCustomBody(e.target.value)}
                dir={lang === "ar" ? "rtl" : "ltr"}
              />
            </div>
          )}

          {/* Preview */}
          <div className="space-y-1.5">
            <Label className="text-xs">Preview</Label>
            <div
              className="rounded-md border bg-card p-3 text-sm whitespace-pre-wrap leading-relaxed min-h-[64px]"
              dir={lang === "ar" ? "rtl" : "ltr"}
            >
              {previewBody || (
                <span className="text-muted-foreground italic">
                  Nothing to preview yet.
                </span>
              )}
            </div>
          </div>

          {/* Result */}
          {result && (
            <div
              className={`rounded-md border p-3 text-sm ${result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300"}`}
            >
              {result.ok ? (
                <div className="flex items-center gap-2">
                  <span>
                    {result.mock ? "Mock send recorded." : "Message sent."}
                  </span>
                  {result.mock && (
                    <Badge variant="secondary" className="text-[10px]">
                      mock
                    </Badge>
                  )}
                  {result.messageId && (
                    <span className="font-mono text-[10px] opacity-70">
                      {result.messageId}
                    </span>
                  )}
                </div>
              ) : (
                <span>Send failed: {result.error}</span>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => sendMutation.mutate()} disabled={!canSend}>
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1.5" />
            )}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
