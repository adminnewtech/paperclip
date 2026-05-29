import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Plug, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

const MODULE_KEY = "integrations";
const ENTITY_TYPE = "connector";

interface CatalogConnector {
  /** Match key against the connector entity's provider (case-insensitive). */
  provider: string;
  name: string;
  icon: string;
  authMethod: string;
}

const CONNECTOR_CATALOG: CatalogConnector[] = [
  { provider: "shopify", name: "Shopify", icon: "🛍️", authMethod: "MCP / OAuth" },
  { provider: "zoho_books", name: "Zoho Books", icon: "📚", authMethod: "MCP / OAuth" },
  { provider: "supabase", name: "Supabase", icon: "🗄️", authMethod: "MCP / Service key" },
  { provider: "github", name: "GitHub", icon: "🐙", authMethod: "MCP / OAuth" },
  { provider: "meta_ads", name: "Meta Ads", icon: "📣", authMethod: "OAuth" },
  { provider: "wati", name: "WhatsApp / WATI", icon: "💬", authMethod: "API key" },
];

type ConnectorStatus = "connected" | "disconnected" | "error";

interface ResolvedConnector extends CatalogConnector {
  status: ConnectorStatus;
  lastSyncAt: string | null;
  syncedRecords: number | null;
  authMethodLabel: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s/_-]+/g, "");
}

function statusVariant(status: ConnectorStatus): "default" | "secondary" | "destructive" {
  if (status === "connected") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

function statusDotClass(status: ConnectorStatus): string {
  if (status === "connected") return "bg-green-500";
  if (status === "error") return "bg-red-500";
  return "bg-gray-400";
}

function statusLabel(status: ConnectorStatus): string {
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  return "Disconnected";
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function readNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

export function Connectors() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Connectors" }]);
  }, [setBreadcrumbs]);

  const listQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      MODULE_KEY,
      ENTITY_TYPE,
      "",
    ),
    queryFn: () =>
      businessApi.listEntities(selectedCompanyId!, MODULE_KEY, ENTITY_TYPE),
    enabled: !!selectedCompanyId,
  });

  const connectors = useMemo<ResolvedConnector[]>(() => {
    const entities = listQuery.data?.entities ?? [];
    const byProvider = new Map<string, BusinessEntityRow>();
    for (const row of entities) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      const provider = readString(data, "provider") ?? row.name ?? "";
      if (!provider) continue;
      byProvider.set(normalize(provider), row);
    }

    return CONNECTOR_CATALOG.map((entry) => {
      const match =
        byProvider.get(normalize(entry.provider)) ??
        byProvider.get(normalize(entry.name));
      if (!match) {
        return {
          ...entry,
          status: "disconnected" as ConnectorStatus,
          lastSyncAt: null,
          syncedRecords: null,
          authMethodLabel: entry.authMethod,
        };
      }
      const data = (match.data ?? {}) as Record<string, unknown>;
      const rawStatus =
        (readString(data, "status") ?? match.status ?? "disconnected").toLowerCase();
      const status: ConnectorStatus =
        rawStatus === "connected" || rawStatus === "error"
          ? (rawStatus as ConnectorStatus)
          : "disconnected";
      return {
        ...entry,
        status,
        lastSyncAt: readString(data, "lastSyncAt"),
        syncedRecords: readNumber(data, "syncedRecords"),
        authMethodLabel: readString(data, "authMethod") ?? entry.authMethod,
      };
    });
  }, [listQuery.data]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Plug}
        message="Select a workspace to manage connectors."
      />
    );
  }

  if (listQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (listQuery.isError) {
    return (
      <EmptyState
        icon={Plug}
        message={
          (listQuery.error as Error)?.message ??
          "Failed to load connectors. Try again."
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Connectors</h1>
          <p className="text-sm text-muted-foreground">
            Pull data from external services into this workspace.{" "}
            <span className="text-amber-500 font-medium">
              Read-only — this experimental system never writes back to your live
              Shopify, Zoho, or other connected systems.
            </span>
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/business/setup">Manage modules</Link>
        </Button>
      </div>

      {connectors.length === 0 ? (
        <EmptyState icon={Plug} message="No connectors available." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {connectors.map((connector) => (
            <ConnectorCard key={connector.provider} connector={connector} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectorCard({ connector }: { connector: ResolvedConnector }) {
  const isConnected = connector.status === "connected";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="bg-muted/50 p-2 text-xl leading-none"
            aria-hidden="true"
          >
            {connector.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{connector.name}</span>
              <Badge
                variant={statusVariant(connector.status)}
                className="text-[10px] inline-flex items-center gap-1"
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass(
                    connector.status,
                  )}`}
                  aria-hidden="true"
                />
                {statusLabel(connector.status)}
              </Badge>
              <Badge
                variant="secondary"
                className="text-[10px] inline-flex items-center gap-1"
                title="This system only reads from external services; it never writes back."
              >
                🔒 Read-only
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {connector.authMethodLabel} · pull only
            </p>

            {isConnected ? (
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-2">
                  <span>Last sync</span>
                  <span className="font-mono text-foreground/80">
                    {connector.lastSyncAt ?? "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Synced records</span>
                  <span className="font-mono text-foreground/80">
                    {connector.syncedRecords != null
                      ? connector.syncedRecords.toLocaleString()
                      : "—"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <Button size="sm" variant="outline" asChild>
                  <Link to="/business/setup">
                    Connect
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
