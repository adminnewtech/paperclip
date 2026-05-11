import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "@/lib/router";
import { Briefcase, Plus, Search } from "lucide-react";
import type {
  BusinessModuleSpec,
  BusinessEntitySpec,
  BusinessEntityFieldSpec,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

export function BusinessModuleView() {
  const { moduleKey: rawModuleKey } = useParams<{ moduleKey: string }>();
  const moduleKey = rawModuleKey ?? "";
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [q, setQ] = useState("");
  const [activeEntity, setActiveEntity] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const catalogQuery = useQuery({
    queryKey: queryKeys.business.catalog,
    queryFn: () => businessApi.catalog(),
  });

  const moduleSpec: BusinessModuleSpec | undefined = useMemo(
    () => catalogQuery.data?.modules.find((m) => m.key === moduleKey),
    [catalogQuery.data, moduleKey],
  );

  useEffect(() => {
    if (moduleSpec) {
      setBreadcrumbs([
        { label: "Business", href: "/business" },
        { label: moduleSpec.label },
      ]);
    } else {
      setBreadcrumbs([{ label: "Business", href: "/business" }]);
    }
  }, [moduleSpec, setBreadcrumbs]);

  useEffect(() => {
    if (moduleSpec && !activeEntity) {
      setActiveEntity(moduleSpec.entities[0]?.key ?? null);
    }
  }, [moduleSpec, activeEntity]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Briefcase} message="Select a workspace first." />;
  }

  if (catalogQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (!moduleSpec) {
    return (
      <EmptyState
        icon={Briefcase}
        message={`Unknown module: ${moduleKey}`}
      />
    );
  }

  const currentEntity =
    moduleSpec.entities.find((e) => e.key === activeEntity) ??
    moduleSpec.entities[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{moduleSpec.label}</h1>
          <p className="text-sm text-muted-foreground">
            {moduleSpec.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/business">Back to hub</Link>
          </Button>
          {currentEntity && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New {currentEntity.label.toLowerCase()}
            </Button>
          )}
        </div>
      </div>

      {moduleSpec.entities.length > 1 ? (
        <Tabs
          value={currentEntity?.key ?? ""}
          onValueChange={(v) => setActiveEntity(v)}
        >
          <TabsList>
            {moduleSpec.entities.map((entity) => (
              <TabsTrigger key={entity.key} value={entity.key}>
                {entity.pluralLabel}
              </TabsTrigger>
            ))}
          </TabsList>
          {moduleSpec.entities.map((entity) => (
            <TabsContent key={entity.key} value={entity.key} className="mt-4">
              <EntityList
                companyId={selectedCompanyId}
                moduleKey={moduleSpec.key}
                entity={entity}
                q={q}
                onQChange={setQ}
              />
            </TabsContent>
          ))}
        </Tabs>
      ) : currentEntity ? (
        <EntityList
          companyId={selectedCompanyId}
          moduleKey={moduleSpec.key}
          entity={currentEntity}
          q={q}
          onQChange={setQ}
        />
      ) : null}

      {currentEntity && (
        <CreateEntityDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          companyId={selectedCompanyId}
          moduleKey={moduleSpec.key}
          entity={currentEntity}
        />
      )}
    </div>
  );
}

function EntityList({
  companyId,
  moduleKey,
  entity,
  q,
  onQChange,
}: {
  companyId: string;
  moduleKey: string;
  entity: BusinessEntitySpec;
  q: string;
  onQChange: (v: string) => void;
}) {
  const listQuery = useQuery({
    queryKey: queryKeys.business.entities(companyId, moduleKey, entity.key, q),
    queryFn: () =>
      businessApi.listEntities(companyId, moduleKey, entity.key, {
        q: q || undefined,
      }),
  });

  const rows = listQuery.data?.entities ?? [];

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input
          placeholder={`Search ${entity.pluralLabel.toLowerCase()}…`}
          className="pl-8"
          value={q}
          onChange={(e) => onQChange(e.target.value)}
        />
      </div>

      {listQuery.isLoading && <PageSkeleton variant="list" />}

      {!listQuery.isLoading && rows.length === 0 && (
        <EmptyState icon={Briefcase} message={`No ${entity.pluralLabel.toLowerCase()} yet.`} />
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {row.name ?? row.code ?? row.id}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {entity.fields
                        .filter((f) => f.key !== "name")
                        .slice(0, 2)
                        .map((f) => formatField(f, row))
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {row.amountCents != null && (
                      <span className="text-sm font-mono">
                        {(row.amountCents / 100).toLocaleString(undefined, {
                          style: "currency",
                          currency: row.currency ?? "USD",
                        })}
                      </span>
                    )}
                    <StatusBadge entity={entity} status={row.status} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatField(
  field: BusinessEntityFieldSpec,
  row: BusinessEntityRow,
): string | null {
  const value = (row.data as Record<string, unknown>)[field.key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") return null;
  return `${field.label}: ${String(value)}`;
}

function StatusBadge({
  entity,
  status,
}: {
  entity: BusinessEntitySpec;
  status: string;
}) {
  const spec = entity.statusValues?.find((s) => s.value === status);
  const variant =
    spec?.tone === "success"
      ? "default"
      : spec?.tone === "danger"
      ? "destructive"
      : "secondary";
  return (
    <Badge variant={variant} className="text-[10px]">
      {spec?.label ?? status}
    </Badge>
  );
}

function CreateEntityDialog({
  open,
  onOpenChange,
  companyId,
  moduleKey,
  entity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  moduleKey: string;
  entity: BusinessEntitySpec;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: (body: Partial<BusinessEntityRow> & { entityType: string }) =>
      businessApi.createEntity(companyId, moduleKey, entity.key, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business", "entities", companyId, moduleKey, entity.key],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business.summary(companyId),
      });
      onOpenChange(false);
      setValues({});
    },
  });

  function submit() {
    const data: Record<string, unknown> = {};
    let name: string | null = null;
    let code: string | null = null;
    let amountCents: number | null = null;
    for (const field of entity.fields) {
      const raw = values[field.key];
      if (raw === undefined || raw === "") continue;
      if (field.type === "number") data[field.key] = Number(raw);
      else if (field.type === "currency") {
        const num = Number(raw);
        if (!Number.isNaN(num)) {
          amountCents = Math.round(num * 100);
          data[field.key] = num;
        }
      } else {
        data[field.key] = raw;
      }
      if (field.key === "name") name = raw;
      if (field.key === "code") code = raw;
    }
    if (entity.primaryField === "name" && !name) {
      name = (values.name ?? values[entity.fields[0]?.key ?? ""] ?? "") || null;
    }
    if (entity.primaryField === "code" && !code) {
      code = (values.code ?? "") || null;
    }
    createMutation.mutate({
      entityType: entity.key,
      name,
      code,
      amountCents,
      data,
      status: entity.statusValues?.[0]?.value ?? "active",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New {entity.label.toLowerCase()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {entity.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={values[field.key] ?? ""}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
        {createMutation.error && (
          <p className="text-sm text-destructive">
            {(createMutation.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: BusinessEntityFieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {field.type === "textarea" ? (
        <Textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "select" ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type={
            field.type === "number" || field.type === "currency"
              ? "number"
              : field.type === "date"
              ? "date"
              : field.type === "email"
              ? "email"
              : "text"
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.hint && (
        <p className="text-[11px] text-muted-foreground">{field.hint}</p>
      )}
    </div>
  );
}
