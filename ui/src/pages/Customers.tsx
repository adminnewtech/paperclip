import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Users, Search, ArrowRight } from "lucide-react";
import { minorToMajor, currencyFractionDigits } from "@paperclipai/shared";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { businessApi, type BusinessEntityRow } from "../api/business";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

const CRM_MODULE = "crm";
const CONTACT_ENTITY = "contact";
const SALES_MODULE = "sales";
const INVOICE_ENTITY = "invoice";

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function readString(
  data: Record<string, unknown>,
  key: string,
): string | null {
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

function formatAmount(
  amountCents: number | null,
  currency: string | null,
): string {
  return minorToMajor(amountCents ?? 0, currency).toLocaleString(undefined, {
    style: "currency",
    currency: currency ?? "KWD",
    minimumFractionDigits: currencyFractionDigits(currency),
    maximumFractionDigits: currencyFractionDigits(currency),
  });
}

interface CustomerSummary {
  name: string;
  segment: string | null;
  isVip: boolean;
  lifetimeValueCents: number | null;
  currency: string | null;
  orderCount: number | null;
  invoiceCount: number;
}

export function Customers() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [q, setQ] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Customers" }]);
  }, [setBreadcrumbs]);

  const contactsQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      CRM_MODULE,
      CONTACT_ENTITY,
      "",
    ),
    queryFn: () =>
      businessApi.listEntities(selectedCompanyId!, CRM_MODULE, CONTACT_ENTITY),
    enabled: !!selectedCompanyId,
  });

  const invoicesQuery = useQuery({
    queryKey: queryKeys.business.entities(
      selectedCompanyId!,
      SALES_MODULE,
      INVOICE_ENTITY,
      "",
    ),
    queryFn: () =>
      businessApi.listEntities(selectedCompanyId!, SALES_MODULE, INVOICE_ENTITY),
    enabled: !!selectedCompanyId,
  });

  const customers = useMemo<CustomerSummary[]>(() => {
    const contacts = contactsQuery.data?.entities ?? [];
    const invoices = invoicesQuery.data?.entities ?? [];

    const invoiceCountByCustomer = new Map<string, number>();
    for (const invoice of invoices) {
      const data = (invoice.data ?? {}) as Record<string, unknown>;
      const customer = normalizeName(readString(data, "customer"));
      if (!customer) continue;
      invoiceCountByCustomer.set(
        customer,
        (invoiceCountByCustomer.get(customer) ?? 0) + 1,
      );
    }

    return contacts
      .map((contact: BusinessEntityRow): CustomerSummary => {
        const data = (contact.data ?? {}) as Record<string, unknown>;
        const name = contact.name ?? "";
        const tags = contact.tags ?? [];
        return {
          name,
          segment: readString(data, "segment"),
          isVip: tags.some((tag) => normalizeName(tag) === "vip"),
          lifetimeValueCents: contact.amountCents,
          currency: contact.currency,
          orderCount: readNumber(data, "orders"),
          invoiceCount: invoiceCountByCustomer.get(normalizeName(name)) ?? 0,
        };
      })
      .filter((c) => c.name.length > 0)
      .sort(
        (a, b) =>
          (b.lifetimeValueCents ?? 0) - (a.lifetimeValueCents ?? 0),
      );
  }, [contactsQuery.data, invoicesQuery.data]);

  const filtered = useMemo(() => {
    const term = normalizeName(q);
    if (!term) return customers;
    return customers.filter((c) => normalizeName(c.name).includes(term));
  }, [customers, q]);

  if (!selectedCompanyId) {
    return (
      <EmptyState icon={Users} message="Select a workspace to view customers." />
    );
  }

  const isLoading = contactsQuery.isLoading || invoicesQuery.isLoading;
  const error = contactsQuery.error ?? invoicesQuery.error;

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (contactsQuery.isError || invoicesQuery.isError) {
    return (
      <EmptyState
        icon={Users}
        message={
          (error as Error)?.message ?? "Failed to load customers. Try again."
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Unified customer view aggregated from CRM contacts and sales
            invoices.{" "}
            <span className="text-amber-500 font-medium">
              Read-only — aggregated client-side from existing data.
            </span>
          </p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input
          placeholder="Search customers…"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          message={
            customers.length === 0
              ? "No customers yet."
              : "No customers match your search."
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((customer) => (
            <Card key={customer.name}>
              <CardContent className="p-3">
                <Link
                  to={`/customers/${encodeURIComponent(customer.name)}`}
                  className="flex items-center justify-between gap-3 group"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {customer.name}
                      </span>
                      {customer.isVip && (
                        <Badge
                          variant="default"
                          className="text-[10px] bg-amber-500 hover:bg-amber-500"
                        >
                          VIP
                        </Badge>
                      )}
                      {customer.segment && (
                        <Badge variant="secondary" className="text-[10px]">
                          {customer.segment}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {customer.orderCount != null
                        ? `${customer.orderCount} orders`
                        : `${customer.invoiceCount} invoices`}
                      {" · "}
                      {customer.invoiceCount} matched invoice
                      {customer.invoiceCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-mono">
                      {formatAmount(
                        customer.lifetimeValueCents,
                        customer.currency,
                      )}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
