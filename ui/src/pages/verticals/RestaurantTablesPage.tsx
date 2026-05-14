import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  restaurantsApi,
  type CreateTableInput,
  type Table,
  type TableArea,
  type TableStatus,
} from "../../api/business-restaurants";
import { TableMap } from "../../components/business/verticals/TableMap";

const AREAS: TableArea[] = ["main", "outdoor", "vip", "bar"];
const STATUSES: TableStatus[] = [
  "available",
  "occupied",
  "reserved",
  "cleaning",
];

interface FormState {
  name: string;
  capacity: string;
  area: TableArea;
  status: TableStatus;
}

function emptyForm(): FormState {
  return { name: "", capacity: "4", area: "main", status: "available" };
}

export function RestaurantTablesPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Restaurant", href: "/business/restaurant" },
      { label: "Tables" },
    ]);
  }, [setBreadcrumbs]);

  const [editable, setEditable] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Table | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);

  const tablesQuery = useQuery({
    queryKey: ["restaurants", companyId, "tables"],
    queryFn: () => restaurantsApi.listTables(companyId),
    enabled: !!companyId,
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["restaurants", companyId, "tables"],
    });

  const createMutation = useMutation({
    mutationFn: (input: CreateTableInput) =>
      restaurantsApi.createTable(companyId, input),
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
      input: Partial<CreateTableInput>;
    }) => restaurantsApi.updateTable(companyId, id, input),
    onSuccess: () => {
      void refresh();
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => restaurantsApi.deleteTable(companyId, id),
    onSuccess: refresh,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TableStatus }) =>
      restaurantsApi.setTableStatus(companyId, id, status),
    onSuccess: refresh,
  });

  const moveMutation = useMutation({
    mutationFn: ({
      id,
      position,
    }: {
      id: string;
      position: { x: number; y: number };
    }) =>
      restaurantsApi.updateTable(companyId, id, { position }),
    onSuccess: refresh,
  });

  if (!selectedCompany) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a company first.
      </div>
    );
  }
  if (tablesQuery.isLoading) return <PageSkeleton />;

  const tables = tablesQuery.data?.tables ?? [];

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(table: Table) {
    setEditing(table);
    setForm({
      name: table.name,
      capacity: String(table.capacity),
      area: table.area,
      status: table.status,
    });
    setDialogOpen(true);
  }

  function buildInput(): CreateTableInput {
    return {
      name: form.name.trim(),
      capacity: Math.max(1, Math.round(Number(form.capacity || "1"))),
      area: form.area,
      status: form.status,
    };
  }

  function handleSubmit() {
    const input = buildInput();
    if (!input.name) return;
    if (editing) updateMutation.mutate({ id: editing.id, input });
    else createMutation.mutate(input);
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tables</h1>
          <p className="text-sm text-muted-foreground">
            {tables.length} tables · drag mode {editable ? "ON" : "OFF"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={editable ? "default" : "outline"}
            onClick={() => setEditable((v) => !v)}
          >
            {editable ? "Done editing" : "Edit layout"}
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New table
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="p-3">
            <TableMap
              tables={tables}
              editable={editable}
              onSelect={(t) => setSelectedTable(t)}
              onMove={(t, position) =>
                moveMutation.mutate({ id: t.id, position })
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selectedTable ? selectedTable.name : "Tables"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedTable ? (
              <div className="space-y-3">
                <div className="text-sm">
                  Capacity: <strong>{selectedTable.capacity}</strong>
                </div>
                <div className="text-sm capitalize">
                  Area: <strong>{selectedTable.area}</strong>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Status
                  </Label>
                  <Select
                    value={selectedTable.status}
                    onValueChange={(v) =>
                      statusMutation.mutate({
                        id: selectedTable.id,
                        status: v as TableStatus,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedTable.currentOrderId ? (
                  <Badge>Has open order</Badge>
                ) : null}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(selectedTable)}
                  >
                    <Pencil className="mr-1 h-4 w-4" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      if (confirm(`Delete table "${selectedTable.name}"?`)) {
                        deleteMutation.mutate(selectedTable.id);
                        setSelectedTable(null);
                      }
                    }}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Tap a table on the map to manage it. Toggle{" "}
                <em>Edit layout</em> to drag tables around.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit table" : "New table"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Table 12"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Capacity *</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.capacity}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, capacity: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label>Area</Label>
                <Select
                  value={form.area}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, area: v as TableArea }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AREAS.map((a) => (
                      <SelectItem key={a} value={a} className="capitalize">
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Initial status</Label>
              <Select
                value={form.status}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, status: v as TableStatus }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                !form.name.trim()
              }
            >
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
