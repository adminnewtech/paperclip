import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import {
  restaurantsApi,
  type MenuItem,
  type Order,
  type OrderType,
  type PaymentMethod,
  type Table,
} from "../../api/business-restaurants";
import { MenuGrid } from "../../components/business/verticals/MenuGrid";
import { PosOrderPanel } from "../../components/business/verticals/PosOrderPanel";

export function RestaurantPosPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Restaurant", href: "/business/restaurant" },
      { label: "POS" },
    ]);
  }, [setBreadcrumbs]);

  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<OrderType>("dine_in");
  const [draftTableId, setDraftTableId] = useState<string | null>(null);
  const [draftCustomerName, setDraftCustomerName] = useState("");
  const [draftCustomerPhone, setDraftCustomerPhone] = useState("");

  const menuQuery = useQuery({
    queryKey: ["restaurants", companyId, "menu"],
    queryFn: () =>
      restaurantsApi.listMenu(companyId, { available: true }),
    enabled: !!companyId,
  });

  const tablesQuery = useQuery({
    queryKey: ["restaurants", companyId, "tables"],
    queryFn: () => restaurantsApi.listTables(companyId),
    enabled: !!companyId,
  });

  const orderQuery = useQuery({
    queryKey: ["restaurants", companyId, "order", activeOrderId],
    queryFn: () =>
      activeOrderId
        ? restaurantsApi.getOrder(companyId, activeOrderId)
        : Promise.resolve(null),
    enabled: !!companyId && !!activeOrderId,
  });

  const refreshOrder = () => {
    void queryClient.invalidateQueries({
      queryKey: ["restaurants", companyId, "order", activeOrderId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["restaurants", companyId, "tables"],
    });
  };

  const createOrderMutation = useMutation({
    mutationFn: async (firstItem: MenuItem) => {
      const order = await restaurantsApi.createOrder(companyId, {
        type: draftType,
        tableId: draftType === "dine_in" ? draftTableId ?? undefined : undefined,
        customerName:
          draftType !== "dine_in" ? draftCustomerName || undefined : undefined,
        customerPhone:
          draftType !== "dine_in" ? draftCustomerPhone || undefined : undefined,
        items: [
          {
            itemId: firstItem.id,
            quantity: 1,
          },
        ],
      });
      return order;
    },
    onSuccess: (order) => {
      setActiveOrderId(order.id);
      refreshOrder();
    },
  });

  const addItemMutation = useMutation({
    mutationFn: (item: MenuItem) =>
      restaurantsApi.addItem(companyId, activeOrderId!, {
        itemId: item.id,
        quantity: 1,
      }),
    onSuccess: refreshOrder,
  });

  const removeItemMutation = useMutation({
    mutationFn: (index: number) =>
      restaurantsApi.removeItem(companyId, activeOrderId!, index),
    onSuccess: refreshOrder,
  });

  const voidItemMutation = useMutation({
    mutationFn: ({ index, reason }: { index: number; reason: string }) =>
      restaurantsApi.voidItem(companyId, activeOrderId!, index, reason),
    onSuccess: refreshOrder,
  });

  const discountMutation = useMutation({
    mutationFn: ({ cents, reason }: { cents: number; reason?: string }) =>
      restaurantsApi.applyDiscount(companyId, activeOrderId!, cents, reason),
    onSuccess: refreshOrder,
  });

  const paymentMutation = useMutation({
    mutationFn: (body: { method: PaymentMethod; amountCents: number }) =>
      restaurantsApi.takePayment(companyId, activeOrderId!, body),
    onSuccess: refreshOrder,
  });

  const sendToKitchenMutation = useMutation({
    mutationFn: () =>
      restaurantsApi.sendToKitchen(companyId, activeOrderId!),
    onSuccess: refreshOrder,
  });

  const closeOrderMutation = useMutation({
    mutationFn: () => restaurantsApi.closeOrder(companyId, activeOrderId!),
    onSuccess: (order) => {
      refreshOrder();
      void queryClient.invalidateQueries({
        queryKey: ["restaurants", companyId, "dashboard"],
      });
      // Start a fresh draft after closing
      setActiveOrderId(null);
      setDraftTableId(null);
      setDraftCustomerName("");
      setDraftCustomerPhone("");
      // Keep the same order type as a UX nicety
      setDraftType(order.type);
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: (reason: string) =>
      restaurantsApi.cancelOrder(companyId, activeOrderId!, reason),
    onSuccess: () => {
      refreshOrder();
      setActiveOrderId(null);
    },
  });

  const tables = useMemo<Table[]>(
    () => tablesQuery.data?.tables ?? [],
    [tablesQuery.data],
  );
  const menu = menuQuery.data?.items ?? [];
  const order: Order | null = orderQuery.data ?? null;
  const busy =
    createOrderMutation.isPending ||
    addItemMutation.isPending ||
    removeItemMutation.isPending ||
    voidItemMutation.isPending ||
    discountMutation.isPending ||
    paymentMutation.isPending ||
    sendToKitchenMutation.isPending ||
    closeOrderMutation.isPending ||
    cancelOrderMutation.isPending;

  function handleMenuSelect(item: MenuItem) {
    if (activeOrderId && order) {
      addItemMutation.mutate(item);
    } else {
      if (draftType === "dine_in" && !draftTableId) {
        // Need a table for dine-in
        return;
      }
      createOrderMutation.mutate(item);
    }
  }

  function handlePrintBill() {
    if (typeof window !== "undefined") window.print();
  }

  if (!selectedCompany) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a company first.
      </div>
    );
  }
  if (menuQuery.isLoading || tablesQuery.isLoading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex items-center justify-between border-b p-3">
        <h1 className="text-lg font-semibold">Point of Sale</h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {order ? (
            <>
              <span>Active order:</span>
              <span className="font-mono">{order.code}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setActiveOrderId(null)}
              >
                New order
              </Button>
            </>
          ) : (
            <span>Start an order by tapping a menu item.</span>
          )}
        </div>
      </header>
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[420px_1fr]">
        <aside className="border-r bg-card">
          <PosOrderPanel
            order={order}
            tables={tables}
            draftType={draftType}
            draftTableId={draftTableId}
            draftCustomerName={draftCustomerName}
            draftCustomerPhone={draftCustomerPhone}
            onTypeChange={setDraftType}
            onTableChange={setDraftTableId}
            onCustomerNameChange={setDraftCustomerName}
            onCustomerPhoneChange={setDraftCustomerPhone}
            onRemoveItem={(idx) => removeItemMutation.mutate(idx)}
            onVoidItem={(idx, reason) =>
              voidItemMutation.mutate({ index: idx, reason })
            }
            onApplyDiscount={(cents, reason) =>
              discountMutation.mutate({ cents, reason })
            }
            onTakePayment={(method, amountCents) =>
              paymentMutation.mutate({ method, amountCents })
            }
            onSendToKitchen={() => sendToKitchenMutation.mutate()}
            onPrintBill={handlePrintBill}
            onCloseOrder={() => closeOrderMutation.mutate()}
            onCancelOrder={(reason) => cancelOrderMutation.mutate(reason)}
            busy={busy}
          />
        </aside>
        <main className="overflow-hidden">
          <MenuGrid items={menu} onSelect={handleMenuSelect} disabled={busy} />
        </main>
      </div>
    </div>
  );
}
