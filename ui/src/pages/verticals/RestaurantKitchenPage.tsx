import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChefHat, Clock, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import {
  restaurantsApi,
  type KitchenTicket,
} from "../../api/business-restaurants";

const STATIONS = ["all", "kitchen", "bar", "grill", "cold"] as const;
type StationFilter = (typeof STATIONS)[number];

function ageColor(ageSeconds: number): {
  bg: string;
  border: string;
  badge: "default" | "outline" | "destructive";
  label: string;
} {
  const minutes = ageSeconds / 60;
  if (minutes >= 15) {
    return {
      bg: "bg-rose-50 dark:bg-rose-950",
      border: "border-rose-500",
      badge: "destructive",
      label: "Overdue",
    };
  }
  if (minutes >= 5) {
    return {
      bg: "bg-amber-50 dark:bg-amber-950",
      border: "border-amber-500",
      badge: "default",
      label: "Warning",
    };
  }
  return {
    bg: "bg-emerald-50 dark:bg-emerald-950",
    border: "border-emerald-500",
    badge: "outline",
    label: "Fresh",
  };
}

function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) return `${ageSeconds}s`;
  const minutes = Math.floor(ageSeconds / 60);
  const seconds = ageSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function RestaurantKitchenPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Restaurant", href: "/business/restaurant" },
      { label: "Kitchen" },
    ]);
  }, [setBreadcrumbs]);

  const [station, setStation] = useState<StationFilter>("all");

  const ticketsQuery = useQuery({
    queryKey: ["restaurants", companyId, "kitchen", station],
    queryFn: () =>
      restaurantsApi.listKitchen(companyId, {
        station: station === "all" ? undefined : station,
      }),
    enabled: !!companyId,
    refetchInterval: 10_000,
  });

  // Local clock for live age display; bumps every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["restaurants", companyId, "kitchen"],
    });

  const markReadyMutation = useMutation({
    mutationFn: ({ orderId, index }: { orderId: string; index: number }) =>
      restaurantsApi.markItemReady(companyId, orderId, index),
    onSuccess: refresh,
  });

  const serveMutation = useMutation({
    mutationFn: (orderId: string) =>
      restaurantsApi.markServed(companyId, orderId),
    onSuccess: refresh,
  });

  const tickets = useMemo<KitchenTicket[]>(() => {
    const list = ticketsQuery.data?.tickets ?? [];
    // Recompute ageSeconds against the live clock for snappy UX.
    return list.map((t) => ({
      ...t,
      ageSeconds: Math.max(
        0,
        Math.round((now - new Date(t.createdAt).getTime()) / 1000),
      ),
    }));
  }, [ticketsQuery.data, now]);

  if (!selectedCompany) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Select a company first.
      </div>
    );
  }
  if (ticketsQuery.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Kitchen display</h1>
          <p className="text-sm text-muted-foreground">
            Auto-refreshing every 10s. Tap items as they go out.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {STATIONS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={station === s ? "default" : "outline"}
              onClick={() => setStation(s)}
              className="capitalize"
            >
              {s}
            </Button>
          ))}
        </div>
      </header>

      {tickets.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            <ChefHat className="mx-auto mb-2 h-8 w-8 opacity-50" />
            No active kitchen tickets. The line is clear.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tickets.map((ticket) => {
            const c = ageColor(ticket.ageSeconds);
            const allReady = ticket.items.every(
              (i) => i.status === "ready",
            );
            return (
              <Card
                key={ticket.orderId}
                className={`border-2 ${c.border} ${c.bg}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="font-mono">{ticket.orderCode}</span>
                    <Badge variant={c.badge}>{c.label}</Badge>
                  </CardTitle>
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      {ticket.tableName ? `Table: ${ticket.tableName}` : "—"}
                    </span>
                    <span className="flex items-center gap-1 font-mono">
                      <Clock className="h-3 w-3" /> {formatAge(ticket.ageSeconds)}
                    </span>
                  </div>
                  <div className="text-[10px] uppercase tracking-wide opacity-75">
                    Station: {ticket.station}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <ul className="space-y-1">
                    {ticket.items.map((it, idx) => (
                      <li
                        key={`${it.itemIndex}-${idx}`}
                        className="flex items-start justify-between gap-2 rounded-md bg-background/60 p-2"
                      >
                        <div className="flex-1">
                          <div className="text-sm font-semibold">
                            {it.quantity}× {it.name}
                          </div>
                          {it.modifiers.length > 0 ? (
                            <div className="text-xs text-muted-foreground">
                              {it.modifiers.join(", ")}
                            </div>
                          ) : null}
                          {it.notes ? (
                            <div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                              <Flag className="h-3 w-3" />
                              {it.notes}
                            </div>
                          ) : null}
                        </div>
                        {it.status === "ready" ? (
                          <Badge variant="outline">
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Ready
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              markReadyMutation.mutate({
                                orderId: ticket.orderId,
                                index: it.itemIndex,
                              })
                            }
                          >
                            Ready
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {allReady ? (
                    <Button
                      className="w-full"
                      onClick={() => serveMutation.mutate(ticket.orderId)}
                    >
                      Mark all served
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
