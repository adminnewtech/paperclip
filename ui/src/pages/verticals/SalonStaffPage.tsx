import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
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
  type Appointment,
  type CreateStylistInput,
  type Stylist,
} from "../../api/business-salons";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function SalonStaffPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Stylist | null>(null);
  const [form, setForm] = useState<CreateStylistInput & { specialtiesText: string }>(
    {
      name: "",
      email: "",
      phone: "",
      specialties: [],
      specialtiesText: "",
    },
  );

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Salon", href: "/business/salon" },
      { label: "Staff" },
    ]);
  }, [setBreadcrumbs]);

  const stylistsQuery = useQuery({
    queryKey: ["salons", companyId, "stylists"],
    queryFn: () => salonsApi.listStylists(companyId),
    enabled: !!companyId,
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60_000);
  const todayApptsQuery = useQuery({
    queryKey: [
      "salons",
      companyId,
      "appointments",
      todayStart.toISOString(),
      todayEnd.toISOString(),
    ],
    queryFn: () =>
      salonsApi.listAppointments(companyId, {
        from: todayStart.toISOString(),
        to: todayEnd.toISOString(),
      }),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["salons", companyId] });

  const createMutation = useMutation({
    mutationFn: (input: CreateStylistInput) =>
      salonsApi.createStylist(companyId, input),
    onSuccess: () => {
      void invalidate();
      setDialogOpen(false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: (params: { id: string; input: Partial<CreateStylistInput> }) =>
      salonsApi.updateStylist(companyId, params.id, params.input),
    onSuccess: () => {
      void invalidate();
      setDialogOpen(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => salonsApi.deleteStylist(companyId, id),
    onSuccess: invalidate,
  });

  if (!selectedCompany) {
    return <div className="p-6 text-sm text-muted-foreground">Select a company first.</div>;
  }
  if (stylistsQuery.isLoading) return <PageSkeleton />;

  const stylists = stylistsQuery.data?.stylists ?? [];
  const todayAppts: Appointment[] =
    todayApptsQuery.data?.appointments?.filter((a) =>
      sameDay(new Date(a.startAt), new Date()),
    ) ?? [];

  function openNew() {
    setEditing(null);
    setForm({
      name: "",
      email: "",
      phone: "",
      specialties: [],
      specialtiesText: "",
    });
    setDialogOpen(true);
  }
  function openEdit(s: Stylist) {
    setEditing(s);
    setForm({
      name: s.name,
      email: s.email ?? "",
      phone: s.phone ?? "",
      specialties: s.specialties,
      specialtiesText: s.specialties.join(", "),
    });
    setDialogOpen(true);
  }
  function handleSubmit() {
    if (!form.name.trim()) return;
    const input: CreateStylistInput = {
      name: form.name,
      email: form.email || undefined,
      phone: form.phone || undefined,
      specialties: form.specialtiesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, input });
    } else {
      createMutation.mutate(input);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stylists</h1>
          <p className="text-sm text-muted-foreground">
            Your staff roster and their daily load.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" /> New stylist
        </Button>
      </header>

      {stylists.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={Users}
              message="No stylists yet. Add your first team member or run 'Setup defaults' on the Services page."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stylists.map((s) => {
            const todayCount = todayAppts.filter(
              (a) => a.stylistId === s.id,
            ).length;
            return (
              <Card key={s.id}>
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                    {initials(s.name)}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.phone ?? s.email ?? "No contact info"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.specialties.map((sp) => (
                        <span
                          key={sp}
                          className="rounded-full bg-muted px-2 py-0.5 text-[10px]"
                        >
                          {sp}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 text-xs">
                      <span className="font-semibold">{todayCount}</span>{" "}
                      appointments today
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(s.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit stylist" : "New stylist"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email ?? ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, email: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={form.phone ?? ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, phone: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Specialties (comma-separated)</Label>
              <Input
                value={form.specialtiesText}
                onChange={(e) =>
                  setForm((p) => ({ ...p, specialtiesText: e.target.value }))
                }
                placeholder="Hair, Makeup, Nails"
              />
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
