import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import {
  formatKwd,
  groupByCategory,
  restaurantsApi,
  type CreateMenuItemInput,
  type MenuItem,
  type MenuItemStation,
} from "../../api/business-restaurants";

const STATIONS: MenuItemStation[] = ["kitchen", "bar", "grill", "cold"];
const DEFAULT_CATEGORIES = [
  "Appetizers",
  "Mains",
  "Sides",
  "Beverages",
  "Desserts",
];

interface FormState {
  name: string;
  nameAr: string;
  category: string;
  priceMajor: string;
  costMajor: string;
  station: MenuItemStation;
  preparationTimeMinutes: string;
  isAvailable: boolean;
}

function emptyForm(): FormState {
  return {
    name: "",
    nameAr: "",
    category: "Mains",
    priceMajor: "",
    costMajor: "",
    station: "kitchen",
    preparationTimeMinutes: "10",
    isAvailable: true,
  };
}

export function RestaurantMenuPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Restaurant", href: "/business/restaurant" },
      { label: "Menu" },
    ]);
  }, [setBreadcrumbs]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const menuQuery = useQuery({
    queryKey: ["restaurants", companyId, "menu"],
    queryFn: () => restaurantsApi.listMenu(companyId),
    enabled: !!companyId,
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["restaurants", companyId, "menu"],
    });

  const createMutation = useMutation({
    mutationFn: (input: CreateMenuItemInput) =>
      restaurantsApi.createMenuItem(companyId, input),
    onSuccess: () => {
      void refresh();
      setDialogOpen(false);
      setForm(emptyForm());
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Partial<CreateMenuItemInput>;
    }) => restaurantsApi.updateMenuItem(companyId, id, input),
    onSuccess: () => {
      void refresh();
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => restaurantsApi.deleteMenuItem(companyId, id),
    onSuccess: refresh,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      restaurantsApi.toggleAvailability(companyId, id, available),
    onSuccess: refresh,
  });

  const items = menuQuery.data?.items ?? [];
  const grouped = useMemo(() => groupByCategory(items), [items]);
  const categories = useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES);
    for (const item of items) set.add(item.category);
    return Array.from(set);
  }, [items]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(item: MenuItem) {
    setEditing(item);
    setForm({
      name: item.name,
      nameAr: item.nameAr,
      category: item.category,
      priceMajor: (item.priceCents / 1000).toFixed(3),
      costMajor:
        item.costCents !== undefined
          ? (item.costCents / 1000).toFixed(3)
          : "",
      station: item.station ?? "kitchen",
      preparationTimeMinutes: String(item.preparationTimeMinutes),
      isAvailable: item.isAvailable,
    });
    setDialogOpen(true);
  }

  function buildInput(): CreateMenuItemInput {
    return {
      name: form.name.trim(),
      nameAr: form.nameAr.trim() || undefined,
      category: form.category.trim() || "Mains",
      priceCents: Math.round(Number(form.priceMajor || "0") * 1000),
      costCents: form.costMajor
        ? Math.round(Number(form.costMajor) * 1000)
        : undefined,
      station: form.station,
      preparationTimeMinutes: Math.max(
        0,
        Math.round(Number(form.preparationTimeMinutes || "0")),
      ),
      isAvailable: form.isAvailable,
    };
  }

  function handleSubmit() {
    const input = buildInput();
    if (!input.name || input.priceCents <= 0) return;
    if (editing) {
      updateMutation.mutate({ id: editing.id, input });
    } else {
      createMutation.mutate(input);
    }
  }

  if (!selectedCompany) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a company first.
      </div>
    );
  }
  if (menuQuery.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Menu</h1>
          <p className="text-sm text-muted-foreground">
            {items.length} items across {grouped.length} categories.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New item
        </Button>
      </header>

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No menu items yet. Click <em>New item</em> to add one, or run{" "}
            <em>Set up defaults</em> from the restaurant dashboard.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ category, items: catItems }) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="text-base">{category}</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2">Name</th>
                      <th>Station</th>
                      <th>Prep</th>
                      <th className="text-right">Price</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catItems.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="py-2">
                          <div className="font-medium">{item.name}</div>
                          {item.nameAr ? (
                            <div className="text-xs text-muted-foreground">
                              {item.nameAr}
                            </div>
                          ) : null}
                        </td>
                        <td className="capitalize">{item.station ?? "—"}</td>
                        <td>{item.preparationTimeMinutes} min</td>
                        <td className="text-right tabular-nums font-semibold">
                          {formatKwd(item.priceCents)}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() =>
                              toggleMutation.mutate({
                                id: item.id,
                                available: !item.isAvailable,
                              })
                            }
                            className="cursor-pointer"
                            title="Toggle availability"
                          >
                            <Badge
                              variant={item.isAvailable ? "default" : "outline"}
                            >
                              {item.isAvailable ? "Available" : "Out"}
                            </Badge>
                          </button>
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(item)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => {
                              if (
                                confirm(`Delete "${item.name}" from the menu?`)
                              ) {
                                deleteMutation.mutate(item.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
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
              {editing ? "Edit menu item" : "New menu item"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="Chicken Machboos"
                />
              </div>
              <div>
                <Label>Arabic name</Label>
                <Input
                  value={form.nameAr}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nameAr: e.target.value }))
                  }
                  placeholder="مجبوس دجاج"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, category: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Station</Label>
                <Select
                  value={form.station}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      station: v as MenuItemStation,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATIONS.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Price (KWD) *</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={form.priceMajor}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, priceMajor: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label>Cost (KWD)</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={form.costMajor}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, costMajor: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label>Prep (min)</Label>
                <Input
                  type="number"
                  value={form.preparationTimeMinutes}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      preparationTimeMinutes: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isAvailable}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isAvailable: e.target.checked }))
                }
              />
              Available for sale
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                createMutation.isPending ||
                updateMutation.isPending ||
                !form.name.trim() ||
                Number(form.priceMajor || "0") <= 0
              }
            >
              {editing ? "Save changes" : "Create item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
