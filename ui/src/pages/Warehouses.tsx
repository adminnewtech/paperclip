import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Warehouse as WarehouseIcon, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { commerceApi, type WarehouseRow } from "../api/commerce";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

export function Warehouses() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Warehouses" }]);
  }, [setBreadcrumbs]);

  const warehousesQuery = useQuery({
    queryKey: queryKeys.commerce.warehouses(selectedCompanyId!),
    queryFn: () => commerceApi.listWarehouses(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const createWarehouse = useMutation({
    mutationFn: (body: { name: string; location?: string | null }) =>
      commerceApi.createWarehouse(selectedCompanyId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.commerce.warehouses(selectedCompanyId!),
      });
      setDialogOpen(false);
      setName("");
      setLocation("");
      pushToast({ title: "Warehouse created", tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to create warehouse",
        body: (error as Error)?.message,
        tone: "error",
      });
    },
  });

  function handleSubmit() {
    if (!selectedCompanyId || !name.trim()) return;
    createWarehouse.mutate({
      name: name.trim(),
      location: location.trim() || undefined,
    });
  }

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={WarehouseIcon}
        message="Select a workspace to manage warehouses."
      />
    );
  }

  if (warehousesQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (warehousesQuery.isError) {
    return (
      <EmptyState
        icon={WarehouseIcon}
        message={
          (warehousesQuery.error as Error)?.message ??
          "Failed to load warehouses. Try again."
        }
      />
    );
  }

  const warehouses = warehousesQuery.data?.warehouses ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Warehouses</h1>
          <p className="text-sm text-muted-foreground">
            Manage stock locations and view on-hand inventory per warehouse.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New warehouse
        </Button>
      </div>

      {warehouses.length === 0 ? (
        <EmptyState icon={WarehouseIcon} message="No warehouses yet." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {warehouses.map((warehouse) => (
            <WarehouseCard
              key={warehouse.id}
              warehouse={warehouse}
              selected={selectedWarehouseId === warehouse.id}
              onSelect={() =>
                setSelectedWarehouseId((prev) =>
                  prev === warehouse.id ? null : warehouse.id,
                )
              }
            />
          ))}
        </div>
      )}

      {selectedWarehouseId && (
        <StockTable
          companyId={selectedCompanyId}
          warehouseId={selectedWarehouseId}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New warehouse</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-name">Name</Label>
              <Input
                id="warehouse-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Main warehouse"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-location">Location</Label>
              <Input
                id="warehouse-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Kuwait City"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createWarehouse.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!name.trim() || createWarehouse.isPending}
            >
              {createWarehouse.isPending ? "Creating…" : "Create warehouse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WarehouseCard({
  warehouse,
  selected,
  onSelect,
}: {
  warehouse: WarehouseRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      className={selected ? "ring-2 ring-primary" : undefined}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <CardContent className="p-4 cursor-pointer">
        <div className="flex items-start gap-3">
          <div className="bg-muted/50 p-2 rounded-md" aria-hidden="true">
            <WarehouseIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{warehouse.name}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{warehouse.location ?? "—"}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {selected ? "Hide stock" : "Click to view stock"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StockTable({
  companyId,
  warehouseId,
}: {
  companyId: string;
  warehouseId: string;
}) {
  const stockQuery = useQuery({
    queryKey: queryKeys.commerce.stock(companyId, warehouseId),
    queryFn: () => commerceApi.listStock(companyId, warehouseId),
    enabled: !!companyId && !!warehouseId,
  });

  if (stockQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (stockQuery.isError) {
    return (
      <EmptyState
        icon={WarehouseIcon}
        message={
          (stockQuery.error as Error)?.message ??
          "Failed to load stock. Try again."
        }
      />
    );
  }

  const stock = stockQuery.data?.stock ?? [];

  if (stock.length === 0) {
    return (
      <EmptyState
        icon={WarehouseIcon}
        message="No stock recorded for this warehouse."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-start font-medium px-4 py-2">
                Product / Variant
              </th>
              <th className="text-end font-medium px-4 py-2">Qty</th>
              <th className="text-end font-medium px-4 py-2">Reserved</th>
              <th className="text-end font-medium px-4 py-2">Reorder point</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((row) => {
              const low =
                row.reorderPoint != null && row.qty <= row.reorderPoint;
              return (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2">
                    <div className="font-medium truncate">
                      {row.productName ?? "Unknown product"}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {row.variantSku ?? row.variantBarcode ?? row.variantId}
                    </div>
                  </td>
                  <td
                    className={`px-4 py-2 text-end font-mono ${
                      low ? "text-amber-500 font-semibold" : ""
                    }`}
                  >
                    {row.qty.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-end font-mono text-muted-foreground">
                    {row.reserved.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-end font-mono text-muted-foreground">
                    {row.reorderPoint != null
                      ? row.reorderPoint.toLocaleString()
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
