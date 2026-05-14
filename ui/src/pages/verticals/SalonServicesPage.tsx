import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import {
  salonsApi,
  type CreateSalonServiceInput,
  type SalonServiceEntity,
} from "../../api/business-salons";

function formatPrice(cents: number): string {
  return `${(cents / 1000).toFixed(3)} KWD`;
}

export function SalonServicesPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SalonServiceEntity | null>(null);
  const [form, setForm] = useState<CreateSalonServiceInput>({
    name: "",
    category: "Hair",
    durationMinutes: 30,
    priceCents: 0,
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Salon", href: "/business/salon" },
      { label: "Services" },
    ]);
  }, [setBreadcrumbs]);

  const servicesQuery = useQuery({
    queryKey: ["salons", companyId, "services"],
    queryFn: () => salonsApi.listServices(companyId),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["salons", companyId] });

  const createMutation = useMutation({
    mutationFn: (input: CreateSalonServiceInput) =>
      salonsApi.createService(companyId, input),
    onSuccess: () => {
      void invalidate();
      setDialogOpen(false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: (params: { id: string; input: Partial<CreateSalonServiceInput> }) =>
      salonsApi.updateService(companyId, params.id, params.input),
    onSuccess: () => {
      void invalidate();
      setDialogOpen(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => salonsApi.deleteService(companyId, id),
    onSuccess: invalidate,
  });
  const setupMutation = useMutation({
    mutationFn: () => salonsApi.setupDefaults(companyId),
    onSuccess: invalidate,
  });

  if (!selectedCompany) {
    return <div className="p-6 text-sm text-muted-foreground">Select a company first.</div>;
  }
  if (servicesQuery.isLoading) return <PageSkeleton />;

  const services = servicesQuery.data?.services ?? [];

  const groups = new Map<string, SalonServiceEntity[]>();
  for (const s of services) {
    const list = groups.get(s.category) ?? [];
    list.push(s);
    groups.set(s.category, list);
  }

  function openNew() {
    setEditing(null);
    setForm({ name: "", category: "Hair", durationMinutes: 30, priceCents: 0 });
    setDialogOpen(true);
  }
  function openEdit(s: SalonServiceEntity) {
    setEditing(s);
    setForm({
      name: s.name,
      nameAr: s.nameAr,
      category: s.category,
      durationMinutes: s.durationMinutes,
      priceCents: s.priceCents,
    });
    setDialogOpen(true);
  }
  function handleSubmit() {
    if (!form.name.trim()) return;
    if (editing) {
      updateMutation.mutate({ id: editing.id, input: form });
    } else {
      createMutation.mutate(form);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Services</h1>
          <p className="text-sm text-muted-foreground">
            Configure your service catalog and prices.
          </p>
        </div>
        <div className="flex gap-2">
          {services.length === 0 ? (
            <Button
              variant="outline"
              onClick={() => setupMutation.mutate()}
              disabled={setupMutation.isPending}
            >
              <Sparkles className="mr-2 h-4 w-4" /> Setup defaults
            </Button>
          ) : null}
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> New service
          </Button>
        </div>
      </header>

      {services.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={Sparkles}
              message="No services yet. Use 'Setup defaults' to seed 15 common salon services."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Array.from(groups.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([category, list]) => (
              <Card key={category}>
                <CardContent className="p-0">
                  <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide">
                    {category}
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2">Code</th>
                        <th className="px-4 py-2">Name</th>
                        <th className="px-4 py-2">Duration</th>
                        <th className="px-4 py-2 text-right">Price</th>
                        <th className="px-4 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((s) => (
                        <tr key={s.id} className="border-t">
                          <td className="px-4 py-2 font-mono text-xs">
                            {s.code}
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-medium">{s.name}</div>
                            {s.nameAr ? (
                              <div className="text-xs text-muted-foreground">
                                {s.nameAr}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2">{s.durationMinutes} min</td>
                          <td className="px-4 py-2 text-right">
                            {formatPrice(s.priceCents)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(s)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteMutation.mutate(s.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit service" : "New service"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name (English)</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Name (Arabic)</Label>
              <Input
                value={form.nameAr ?? ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, nameAr: e.target.value }))
                }
                dir="rtl"
              />
            </div>
            <div>
              <Label>Category</Label>
              <Input
                value={form.category ?? ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, category: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  min={5}
                  step={5}
                  value={form.durationMinutes}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      durationMinutes: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div>
                <Label>Price (fils)</Label>
                <Input
                  type="number"
                  min={0}
                  step={500}
                  value={form.priceCents}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      priceCents: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
