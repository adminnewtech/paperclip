import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "../EmptyState";
import {
  businessWhatsappApi,
  type WhatsappTemplate,
  type WhatsappTemplateComponent,
  type WhatsappTemplateStatus,
} from "../../api/business-whatsapp";

interface WhatsappTemplateManagerProps {
  companyId: string;
}

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "en_US", label: "English (US)" },
  { value: "ar", label: "Arabic" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
];

const CATEGORIES: Array<{ value: WhatsappTemplate["category"]; label: string }> = [
  { value: "UTILITY", label: "Utility" },
  { value: "MARKETING", label: "Marketing" },
  { value: "AUTHENTICATION", label: "Authentication" },
];

function StatusPill({ status }: { status?: WhatsappTemplateStatus }) {
  if (status === "APPROVED") {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Approved
      </Badge>
    );
  }
  if (status === "PENDING") {
    return (
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-400">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  }
  if (status === "REJECTED") {
    return (
      <Badge className="bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-400">
        <XCircle className="h-3 w-3 mr-1" />
        Rejected
      </Badge>
    );
  }
  if (status === "PAUSED" || status === "DISABLED") {
    return (
      <Badge variant="secondary">
        <AlertTriangle className="h-3 w-3 mr-1" />
        {status}
      </Badge>
    );
  }
  return <Badge variant="outline">Unknown</Badge>;
}

interface NewTemplateState {
  name: string;
  language: string;
  category: WhatsappTemplate["category"];
  headerText: string;
  bodyText: string;
  footerText: string;
  bodyExamples: string;
}

function emptyNewTemplate(): NewTemplateState {
  return {
    name: "",
    language: "en",
    category: "UTILITY",
    headerText: "",
    bodyText: "",
    footerText: "",
    bodyExamples: "",
  };
}

function buildComponents(state: NewTemplateState): WhatsappTemplateComponent[] {
  const components: WhatsappTemplateComponent[] = [];
  if (state.headerText.trim()) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: state.headerText.trim(),
    });
  }
  const body: WhatsappTemplateComponent = {
    type: "BODY",
    text: state.bodyText.trim(),
  };
  if (state.bodyExamples.trim()) {
    const examples = state.bodyExamples
      .split(/\r?\n/)
      .map((line) => line.split(",").map((v) => v.trim()).filter(Boolean))
      .filter((row) => row.length > 0);
    if (examples.length > 0) {
      body.example = { body_text: examples };
    }
  }
  components.push(body);
  if (state.footerText.trim()) {
    components.push({ type: "FOOTER", text: state.footerText.trim() });
  }
  return components;
}

export function WhatsappTemplateManager({
  companyId,
}: WhatsappTemplateManagerProps) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<NewTemplateState>(emptyNewTemplate());
  const [formError, setFormError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["whatsapp-templates", companyId],
    queryFn: () => businessWhatsappApi.listTemplates(companyId),
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      language: string;
      category: WhatsappTemplate["category"];
      components: WhatsappTemplateComponent[];
    }) => businessWhatsappApi.createTemplate(companyId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp-templates", companyId],
      });
      setDialogOpen(false);
      setForm(emptyNewTemplate());
      setFormError(null);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) =>
      businessWhatsappApi.deleteTemplate(companyId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp-templates", companyId],
      });
    },
  });

  const templates = templatesQuery.data?.templates ?? [];
  const configured = templatesQuery.data?.configured === true;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Name is required");
      return;
    }
    if (!/^[a-z0-9_]+$/.test(form.name.trim())) {
      setFormError("Name must be lowercase letters, digits, and underscores");
      return;
    }
    if (!form.bodyText.trim()) {
      setFormError("Body text is required");
      return;
    }
    createMutation.mutate({
      name: form.name.trim(),
      language: form.language,
      category: form.category,
      components: buildComponents(form),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Message templates</h3>
          <p className="text-xs text-muted-foreground">
            Pre-approved templates synced from Meta. Marketing-category messages
            sent outside the 24h customer window must use an approved template.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Submit new
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Submit new template for approval</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="tpl-name" className="text-xs">
                    Name (snake_case)
                  </Label>
                  <Input
                    id="tpl-name"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="order_confirmation"
                    className="font-mono"
                  />
                </div>
                <div>
                  <Label htmlFor="tpl-lang" className="text-xs">
                    Language
                  </Label>
                  <Select
                    value={form.language}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, language: v }))
                    }
                  >
                    <SelectTrigger id="tpl-lang">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="tpl-category" className="text-xs">
                  Category
                </Label>
                <Select
                  value={form.category}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      category: v as WhatsappTemplate["category"],
                    }))
                  }
                >
                  <SelectTrigger id="tpl-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="tpl-header" className="text-xs">
                  Header (optional)
                </Label>
                <Input
                  id="tpl-header"
                  value={form.headerText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, headerText: e.target.value }))
                  }
                  placeholder="Order #{{1}} confirmed"
                />
              </div>
              <div>
                <Label htmlFor="tpl-body" className="text-xs">
                  Body
                </Label>
                <Textarea
                  id="tpl-body"
                  rows={4}
                  value={form.bodyText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, bodyText: e.target.value }))
                  }
                  placeholder={"Hi {{1}}, your order {{2}} is confirmed."}
                />
              </div>
              <div>
                <Label htmlFor="tpl-examples" className="text-xs">
                  Body examples (one row per line, comma-separated)
                </Label>
                <Textarea
                  id="tpl-examples"
                  rows={2}
                  value={form.bodyExamples}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, bodyExamples: e.target.value }))
                  }
                  placeholder="Sara, A1023"
                />
              </div>
              <div>
                <Label htmlFor="tpl-footer" className="text-xs">
                  Footer (optional)
                </Label>
                <Input
                  id="tpl-footer"
                  value={form.footerText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, footerText: e.target.value }))
                  }
                  placeholder="Reply STOP to unsubscribe"
                />
              </div>
              {formError && (
                <div className="text-xs text-red-600">{formError}</div>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Submitting…" : "Submit"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {!configured && (
        <Card>
          <CardContent className="p-4 text-xs text-muted-foreground">
            WhatsApp Cloud API is not configured. Templates are shown in
            mock-mode only and cannot be submitted to Meta. Set
            <code className="font-mono ml-1">WHATSAPP_BUSINESS_API_TOKEN</code>,{" "}
            <code className="font-mono">WHATSAPP_PHONE_NUMBER_ID</code> and{" "}
            <code className="font-mono">WHATSAPP_BUSINESS_ACCOUNT_ID</code> to
            enable.
          </CardContent>
        </Card>
      )}

      {templatesQuery.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          message="No templates yet. Submit one for approval."
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Language</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={`${t.name}-${t.language}`} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{t.name}</td>
                  <td className="px-3 py-2 text-xs">{t.language}</td>
                  <td className="px-3 py-2 text-xs capitalize">
                    {t.category.toLowerCase()}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={t.status} />
                    {t.status === "REJECTED" && t.rejectedReason && (
                      <p className="text-[10px] text-red-600 mt-1">
                        {t.rejectedReason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete template "${t.name}"? This cannot be undone.`,
                          )
                        ) {
                          deleteMutation.mutate(t.name);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
