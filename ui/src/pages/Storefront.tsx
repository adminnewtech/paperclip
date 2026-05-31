import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Store,
  Layers,
  Radio,
  Tag,
  Truck,
  Package,
  Plus,
} from "lucide-react";
import { currencyFractionDigits, minorToMajor } from "@paperclipai/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { ApiError } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  storefrontApi,
  type ChannelRow,
  type ShippingZoneRow,
} from "../api/storefront";

const DEFAULT_CURRENCY = "KWD";
const TABS = [
  { key: "store", label: "Store", icon: Store },
  { key: "collections", label: "Collections", icon: Layers },
  { key: "channels", label: "Channels", icon: Radio },
  { key: "discounts", label: "Discounts", icon: Tag },
  { key: "shipping", label: "Shipping", icon: Truck },
  { key: "orders", label: "Online Orders", icon: Package },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function formatMinor(amountMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return `${minorToMajor(amountMinor, currency).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

const FRACTION_DIGITS = currencyFractionDigits(DEFAULT_CURRENCY);
const MINOR_PER_MAJOR = Math.round(10 ** FRACTION_DIGITS);

export function Storefront() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<TabKey>("store");

  useEffect(() => {
    setBreadcrumbs([{ label: "Storefront" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Store}
        message="Select a workspace to manage your storefront."
      />
    );
  }

  return (
    <div className="space-y-6" dir="auto">
      <div>
        <h1 className="text-2xl font-semibold">Storefront</h1>
        <p className="text-sm text-muted-foreground">
          Manage your online store, collections, sales channels, discounts,
          shipping, and online orders.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                active
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "store" && <StoreTab companyId={selectedCompanyId} />}
      {tab === "collections" && <CollectionsTab companyId={selectedCompanyId} />}
      {tab === "channels" && <ChannelsTab companyId={selectedCompanyId} />}
      {tab === "discounts" && <DiscountsTab companyId={selectedCompanyId} />}
      {tab === "shipping" && <ShippingTab companyId={selectedCompanyId} />}
      {tab === "orders" && <OrdersTab companyId={selectedCompanyId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Store tab — settings + publish
// ---------------------------------------------------------------------------
function StoreTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [domain, setDomain] = useState("");

  const storesQuery = useQuery({
    queryKey: ["storefront", "stores", companyId],
    queryFn: () => storefrontApi.listStores(companyId),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["storefront", "stores", companyId],
    });

  const createStore = useMutation({
    mutationFn: () =>
      storefrontApi.createStore(companyId, {
        name: name.trim(),
        slug: slug.trim() || undefined,
        domain: domain.trim() || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setName("");
      setSlug("");
      setDomain("");
      pushToast({ title: "Store created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create store",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const togglePublish = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      storefrontApi.updateStore(id, { status }),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Store updated", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to update store",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (storesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (storesQuery.isError) {
    return (
      <EmptyState
        icon={Store}
        message={(storesQuery.error as Error)?.message ?? "Failed to load stores."}
      />
    );
  }

  const stores = storesQuery.data?.stores ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-medium">New store</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="store-name">Name</Label>
              <Input
                id="store-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Online Store"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-slug">Slug</Label>
              <Input
                id="store-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="my-store"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-domain">Domain</Label>
              <Input
                id="store-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="shop.example.com"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => createStore.mutate()}
              disabled={!name.trim() || createStore.isPending}
            >
              <Plus className="me-1.5 h-4 w-4" />
              {createStore.isPending ? "Creating…" : "Create store"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {stores.length === 0 ? (
        <EmptyState icon={Store} message="No stores yet." />
      ) : (
        <div className="space-y-3">
          {stores.map((store) => {
            const published = store.status === "published";
            return (
              <Card key={store.id}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{store.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {store.domain ?? store.slug ?? "—"} · {store.currency}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-xs capitalize ${
                        published ? "text-emerald-500" : "text-amber-500"
                      }`}
                    >
                      {store.status}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={togglePublish.isPending}
                      onClick={() =>
                        togglePublish.mutate({
                          id: store.id,
                          status: published ? "draft" : "published",
                        })
                      }
                    >
                      {published ? "Unpublish" : "Publish"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collections tab
// ---------------------------------------------------------------------------
function CollectionsTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const collectionsQuery = useQuery({
    queryKey: ["storefront", "collections", companyId],
    queryFn: () => storefrontApi.listCollections(companyId),
    enabled: !!companyId,
  });

  const createCollection = useMutation({
    mutationFn: () =>
      storefrontApi.createCollection(companyId, {
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["storefront", "collections", companyId],
      });
      setDialogOpen(false);
      setName("");
      setDescription("");
      pushToast({ title: "Collection created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create collection",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (collectionsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (collectionsQuery.isError) {
    return (
      <EmptyState
        icon={Layers}
        message={
          (collectionsQuery.error as Error)?.message ??
          "Failed to load collections."
        }
      />
    );
  }

  const collections = collectionsQuery.data?.collections ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New collection
        </Button>
      </div>

      {collections.length === 0 ? (
        <EmptyState icon={Layers} message="No collections yet." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {collections.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {c.description ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  {c.productIds.length} product(s)
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="col-name">Name</Label>
              <Input
                id="col-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="col-desc">Description</Label>
              <Input
                id="col-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createCollection.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createCollection.mutate()}
              disabled={!name.trim() || createCollection.isPending}
            >
              {createCollection.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channels tab — online/pos/marketplace/social
// ---------------------------------------------------------------------------
const CHANNEL_KINDS = [
  { value: "online", label: "Online" },
  { value: "pos", label: "Point of Sale" },
  { value: "marketplace", label: "Marketplace" },
  { value: "social", label: "Social" },
] as const;

function ChannelsTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ChannelRow["kind"]>("online");

  const channelsQuery = useQuery({
    queryKey: ["storefront", "channels", companyId],
    queryFn: () => storefrontApi.listChannels(companyId),
    enabled: !!companyId,
  });

  const createChannel = useMutation({
    mutationFn: () =>
      storefrontApi.createChannel(companyId, {
        name: name.trim(),
        kind: (kind ?? "online") as
          | "online"
          | "pos"
          | "marketplace"
          | "social",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["storefront", "channels", companyId],
      });
      setName("");
      pushToast({ title: "Channel created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create channel",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (channelsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (channelsQuery.isError) {
    return (
      <EmptyState
        icon={Radio}
        message={
          (channelsQuery.error as Error)?.message ?? "Failed to load channels."
        }
      />
    );
  }

  const channels = channelsQuery.data?.channels ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-medium">New channel</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="ch-name">Name</Label>
              <Input
                id="ch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Online Store"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-kind">Kind</Label>
              <Select
                value={kind ?? "online"}
                onValueChange={(v) => setKind(v)}
              >
                <SelectTrigger id="ch-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={() => createChannel.mutate()}
              disabled={!name.trim() || createChannel.isPending}
            >
              <Plus className="me-1.5 h-4 w-4" />
              Add channel
            </Button>
          </div>
        </CardContent>
      </Card>

      {channels.length === 0 ? (
        <EmptyState icon={Radio} message="No channels yet." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {channels.map((ch) => (
            <Card key={ch.id}>
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{ch.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {ch.kind ?? "—"}
                  </div>
                </div>
                <span
                  className={`text-xs ${
                    ch.enabled ? "text-emerald-500" : "text-muted-foreground"
                  }`}
                >
                  {ch.enabled ? "Enabled" : "Disabled"}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discounts tab — % or fixed code
// ---------------------------------------------------------------------------
function DiscountsTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"percentage" | "fixed" | "free_shipping">(
    "percentage",
  );
  const [percent, setPercent] = useState("10");
  const [fixedMajor, setFixedMajor] = useState("0");
  const [minOrderMajor, setMinOrderMajor] = useState("0");

  const discountsQuery = useQuery({
    queryKey: ["storefront", "discounts", companyId],
    queryFn: () => storefrontApi.listDiscounts(companyId),
    enabled: !!companyId,
  });

  const createDiscount = useMutation({
    mutationFn: () =>
      storefrontApi.createDiscount(companyId, {
        code: code.trim() || undefined,
        name: name.trim(),
        kind,
        valueBps:
          kind === "percentage"
            ? Math.round((Number(percent) || 0) * 100)
            : 0,
        valueMinor:
          kind === "fixed"
            ? Math.round((Number(fixedMajor) || 0) * MINOR_PER_MAJOR)
            : 0,
        minOrderMinor: Math.round(
          (Number(minOrderMajor) || 0) * MINOR_PER_MAJOR,
        ),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["storefront", "discounts", companyId],
      });
      setDialogOpen(false);
      setCode("");
      setName("");
      setPercent("10");
      setFixedMajor("0");
      setMinOrderMajor("0");
      pushToast({ title: "Discount created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create discount",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (discountsQuery.isLoading) return <PageSkeleton variant="list" />;
  if (discountsQuery.isError) {
    return (
      <EmptyState
        icon={Tag}
        message={
          (discountsQuery.error as Error)?.message ??
          "Failed to load discounts."
        }
      />
    );
  }

  const discounts = discountsQuery.data?.discounts ?? [];

  function describeValue(d: (typeof discounts)[number]): string {
    if (d.kind === "percentage") return `${(d.valueBps / 100).toFixed(2)}%`;
    if (d.kind === "fixed") return formatMinor(d.valueMinor, DEFAULT_CURRENCY);
    return "Free shipping";
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" />
          New discount
        </Button>
      </div>

      {discounts.length === 0 ? (
        <EmptyState icon={Tag} message="No discounts yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Code</th>
                  <th className="text-start font-medium px-4 py-2">Name</th>
                  <th className="text-start font-medium px-4 py-2">Value</th>
                  <th className="text-end font-medium px-4 py-2">Used</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono">{d.code ?? "—"}</td>
                    <td className="px-4 py-2">{d.name}</td>
                    <td className="px-4 py-2">{describeValue(d)}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {d.usedCount}
                      {d.usageLimit != null ? ` / ${d.usageLimit}` : ""}
                    </td>
                    <td className="px-4 py-2 capitalize text-xs">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New discount</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="disc-code">Code</Label>
                <Input
                  id="disc-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="SAVE10"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disc-name">Name</Label>
                <Input
                  id="disc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disc-kind">Type</Label>
              <Select
                value={kind}
                onValueChange={(v) =>
                  setKind(v as "percentage" | "fixed" | "free_shipping")
                }
              >
                <SelectTrigger id="disc-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                  <SelectItem value="free_shipping">Free shipping</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {kind === "percentage" && (
              <div className="space-y-1.5">
                <Label htmlFor="disc-pct">Percent off</Label>
                <Input
                  id="disc-pct"
                  type="number"
                  min={0}
                  max={100}
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                />
              </div>
            )}
            {kind === "fixed" && (
              <div className="space-y-1.5">
                <Label htmlFor="disc-fixed">
                  Amount off ({DEFAULT_CURRENCY})
                </Label>
                <Input
                  id="disc-fixed"
                  type="number"
                  min={0}
                  step={1 / MINOR_PER_MAJOR}
                  value={fixedMajor}
                  onChange={(e) => setFixedMajor(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="disc-min">
                Minimum order ({DEFAULT_CURRENCY})
              </Label>
              <Input
                id="disc-min"
                type="number"
                min={0}
                step={1 / MINOR_PER_MAJOR}
                value={minOrderMajor}
                onChange={(e) => setMinOrderMajor(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createDiscount.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createDiscount.mutate()}
              disabled={!name.trim() || createDiscount.isPending}
            >
              {createDiscount.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shipping tab — zones + rates
// ---------------------------------------------------------------------------
function ShippingTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [zoneName, setZoneName] = useState("");
  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [rateZoneId, setRateZoneId] = useState("");
  const [rateName, setRateName] = useState("");
  const [rateMajor, setRateMajor] = useState("0");
  const [freeAboveMajor, setFreeAboveMajor] = useState("");

  const zonesQuery = useQuery({
    queryKey: ["storefront", "shipping-zones", companyId],
    queryFn: () => storefrontApi.listShippingZones(companyId),
    enabled: !!companyId,
  });

  const ratesQuery = useQuery({
    queryKey: ["storefront", "shipping-rates", companyId],
    queryFn: () => storefrontApi.listShippingRates(companyId),
    enabled: !!companyId,
  });

  const createZone = useMutation({
    mutationFn: () =>
      storefrontApi.createShippingZone(companyId, { name: zoneName.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["storefront", "shipping-zones", companyId],
      });
      setZoneName("");
      pushToast({ title: "Zone created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create zone",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  const createRate = useMutation({
    mutationFn: () =>
      storefrontApi.createShippingRate(companyId, {
        zoneId: rateZoneId,
        name: rateName.trim(),
        priceMinor: Math.round((Number(rateMajor) || 0) * MINOR_PER_MAJOR),
        minOrderFreeMinor: freeAboveMajor.trim()
          ? Math.round((Number(freeAboveMajor) || 0) * MINOR_PER_MAJOR)
          : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["storefront", "shipping-rates", companyId],
      });
      setRateDialogOpen(false);
      setRateName("");
      setRateMajor("0");
      setFreeAboveMajor("");
      pushToast({ title: "Rate created", tone: "success" });
    },
    onError: (e) =>
      pushToast({
        title: "Failed to create rate",
        body: (e as Error)?.message,
        tone: "error",
      }),
  });

  if (zonesQuery.isLoading) return <PageSkeleton variant="list" />;
  if (zonesQuery.isError) {
    return (
      <EmptyState
        icon={Truck}
        message={
          (zonesQuery.error as Error)?.message ?? "Failed to load shipping."
        }
      />
    );
  }

  const zones = zonesQuery.data?.shippingZones ?? [];
  const rates = ratesQuery.data?.shippingRates ?? [];
  const zoneName_ = (id: string) =>
    zones.find((z: ShippingZoneRow) => z.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-medium">New shipping zone</h2>
          <div className="flex gap-2 items-end">
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="zone-name">Name</Label>
              <Input
                id="zone-name"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                placeholder="Kuwait"
              />
            </div>
            <Button
              size="sm"
              onClick={() => createZone.mutate()}
              disabled={!zoneName.trim() || createZone.isPending}
            >
              <Plus className="me-1.5 h-4 w-4" />
              Add zone
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">Zones</h2>
        </div>
        {zones.length === 0 ? (
          <EmptyState icon={Truck} message="No shipping zones yet." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {zones.map((z) => (
              <Card key={z.id}>
                <CardContent className="p-4">
                  <div className="font-medium">{z.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {z.countries.length} country/ies
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">Rates</h2>
          <Button
            size="sm"
            disabled={zones.length === 0}
            onClick={() => {
              setRateZoneId(zones[0]?.id ?? "");
              setRateDialogOpen(true);
            }}
          >
            <Plus className="me-1.5 h-4 w-4" />
            New rate
          </Button>
        </div>
        {rates.length === 0 ? (
          <EmptyState icon={Truck} message="No shipping rates yet." />
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-start font-medium px-4 py-2">Zone</th>
                    <th className="text-start font-medium px-4 py-2">Name</th>
                    <th className="text-end font-medium px-4 py-2">Price</th>
                    <th className="text-end font-medium px-4 py-2">
                      Free above
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-2">{zoneName_(r.zoneId)}</td>
                      <td className="px-4 py-2">{r.name}</td>
                      <td className="px-4 py-2 text-end font-mono">
                        {formatMinor(r.priceMinor, DEFAULT_CURRENCY)}
                      </td>
                      <td className="px-4 py-2 text-end font-mono text-muted-foreground">
                        {r.minOrderFreeMinor != null
                          ? formatMinor(r.minOrderFreeMinor, DEFAULT_CURRENCY)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={rateDialogOpen} onOpenChange={setRateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New shipping rate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rate-zone">Zone</Label>
              <Select value={rateZoneId} onValueChange={setRateZoneId}>
                <SelectTrigger id="rate-zone" className="w-full">
                  <SelectValue placeholder="Select a zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-name">Name</Label>
              <Input
                id="rate-name"
                value={rateName}
                onChange={(e) => setRateName(e.target.value)}
                placeholder="Standard"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rate-price">Price ({DEFAULT_CURRENCY})</Label>
                <Input
                  id="rate-price"
                  type="number"
                  min={0}
                  step={1 / MINOR_PER_MAJOR}
                  value={rateMajor}
                  onChange={(e) => setRateMajor(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-free">
                  Free above ({DEFAULT_CURRENCY})
                </Label>
                <Input
                  id="rate-free"
                  type="number"
                  min={0}
                  step={1 / MINOR_PER_MAJOR}
                  value={freeAboveMajor}
                  onChange={(e) => setFreeAboveMajor(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRateDialogOpen(false)}
              disabled={createRate.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createRate.mutate()}
              disabled={!rateZoneId || !rateName.trim() || createRate.isPending}
            >
              {createRate.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Online orders tab — list + fulfill
// ---------------------------------------------------------------------------
function OrdersTab({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const ordersQuery = useQuery({
    queryKey: ["storefront", "online-orders", companyId],
    queryFn: () => storefrontApi.listOnlineOrders(companyId),
    enabled: !!companyId,
  });

  const fulfill = useMutation({
    mutationFn: (id: string) => storefrontApi.fulfillOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["storefront", "online-orders", companyId],
      });
      pushToast({ title: "Order fulfilled", tone: "success" });
    },
    onError: (e) => {
      const isConflict = e instanceof ApiError && e.status === 409;
      pushToast({
        title: isConflict ? "Cannot fulfill" : "Failed to fulfill",
        body: (e as Error)?.message,
        tone: "error",
      });
    },
  });

  if (ordersQuery.isLoading) return <PageSkeleton variant="list" />;
  if (ordersQuery.isError) {
    return (
      <EmptyState
        icon={Package}
        message={
          (ordersQuery.error as Error)?.message ?? "Failed to load orders."
        }
      />
    );
  }

  const orders = ordersQuery.data?.onlineOrders ?? [];

  return (
    <div className="space-y-4">
      {orders.length === 0 ? (
        <EmptyState icon={Package} message="No online orders yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2">Order</th>
                  <th className="text-start font-medium px-4 py-2">Customer</th>
                  <th className="text-end font-medium px-4 py-2">Total</th>
                  <th className="text-start font-medium px-4 py-2">Status</th>
                  <th className="text-end font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono">
                      {o.number ?? o.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2">{o.customerName ?? "—"}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {formatMinor(o.totalMinor, o.currency)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs capitalize ${
                          o.status === "fulfilled"
                            ? "text-emerald-500"
                            : o.status === "cancelled"
                              ? "text-muted-foreground"
                              : "text-amber-500"
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-end">
                      {o.status !== "fulfilled" &&
                        o.status !== "cancelled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={fulfill.isPending}
                            onClick={() => fulfill.mutate(o.id)}
                          >
                            Fulfill
                          </Button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
