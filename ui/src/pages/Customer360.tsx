import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@/lib/router";
import { Users, ArrowLeft, MapPin, Phone } from "lucide-react";
import { minorToMajor, currencyFractionDigits } from "@paperclipai/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isPaid(status: string): boolean {
  return normalizeName(status) === "paid";
}

export function Customer360() {
  const { name: rawName } = useParams<{ name: string }>();
  const customerName = rawName ? decodeURIComponent(rawName) : "";
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Customers", href: "/customers" },
      { label: customerName || "Customer" },
    ]);
  }, [setBreadcrumbs, customerName]);

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

  const contact = useMemo<BusinessEntityRow | null>(() => {
    const contacts = contactsQuery.data?.entities ?? [];
    const target = normalizeName(customerName);
    return contacts.find((c) => normalizeName(c.name) === target) ?? null;
  }, [contactsQuery.data, customerName]);

  const invoices = useMemo<BusinessEntityRow[]>(() => {
    const all = invoicesQuery.data?.entities ?? [];
    const target = normalizeName(customerName);
    return all
      .filter((invoice) => {
        const data = (invoice.data ?? {}) as Record<string, unknown>;
        return normalizeName(readString(data, "customer")) === target;
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [invoicesQuery.data, customerName]);

  const stats = useMemo(() => {
    const totalSpentCents = invoices.reduce(
      (sum, inv) => sum + (inv.amountCents ?? 0),
      0,
    );
    const paidCount = invoices.filter((inv) => isPaid(inv.status)).length;
    const pendingCount = invoices.length - paidCount;
    const currency =
      contact?.currency ?? invoices[0]?.currency ?? null;
    const lastInvoice = invoices[0] ?? null;
    return {
      totalSpentCents,
      paidCount,
      pendingCount,
      currency,
      lastOrderDate: lastInvoice?.updatedAt ?? null,
    };
  }, [invoices, contact]);

  if (!selectedCompanyId) {
    return (
      <EmptyState icon={Users} message="Select a workspace to view customers." />
    );
  }

  const isLoading = contactsQuery.isLoading || invoicesQuery.isLoading;
  const error = contactsQuery.error ?? invoicesQuery.error;

  if (isLoading) {
    return <PageSkeleton variant="detail" />;
  }

  if (contactsQuery.isError || invoicesQuery.isError) {
    return (
      <EmptyState
        icon={Users}
        message={
          (error as Error)?.message ?? "Failed to load customer. Try again."
        }
      />
    );
  }

  if (!contact && invoices.length === 0) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild>
          <Link to="/customers">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to customers
          </Link>
        </Button>
        <EmptyState
          icon={Users}
          message={`No customer found for "${customerName}".`}
        />
      </div>
    );
  }

  const contactData = (contact?.data ?? {}) as Record<string, unknown>;
  const tags = contact?.tags ?? [];
  const isVip = tags.some((tag) => normalizeName(tag) === "vip");
  const area = readString(contactData, "area");
  const phone = readString(contactData, "phone");
  const segment = readString(contactData, "segment");
  const lifetimeValueCents = contact?.amountCents ?? stats.totalSpentCents;

  return (
    <div className="space-y-6">
      <Button variant="outline" size="sm" asChild>
        <Link to="/customers">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to customers
        </Link>
      </Button>

      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-semibold">{customerName}</h1>
          {isVip && (
            <Badge
              variant="default"
              className="text-[10px] bg-amber-500 hover:bg-amber-500"
            >
              VIP
            </Badge>
          )}
          {segment && (
            <Badge variant="secondary" className="text-[10px]">
              {segment}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          {area && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {area}
            </span>
          )}
          {phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" />
              {phone}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard
          label="Lifetime Value"
          value={formatAmount(lifetimeValueCents, stats.currency)}
        />
        <StatCard label="Total Invoices" value={String(invoices.length)} />
        <StatCard
          label="Paid / Pending"
          value={`${stats.paidCount} / ${stats.pendingCount}`}
        />
        <StatCard label="Last Order" value={formatDate(stats.lastOrderDate)} />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Invoice timeline
        </h2>
        {invoices.length === 0 ? (
          <EmptyState icon={Users} message="No invoices for this customer." />
        ) : (
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <Card key={invoice.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {invoice.name ?? invoice.code ?? invoice.id}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {formatDate(invoice.updatedAt)}
                        {readString(
                          (invoice.data ?? {}) as Record<string, unknown>,
                          "location",
                        )
                          ? ` · ${readString(
                              (invoice.data ?? {}) as Record<string, unknown>,
                              "location",
                            )}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-mono">
                        {formatAmount(invoice.amountCents, invoice.currency)}
                      </span>
                      <InvoiceStatusBadge status={invoice.status} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold mt-1 truncate">{value}</div>
      </CardContent>
    </Card>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const paid = isPaid(status);
  return (
    <Badge
      variant={paid ? "default" : "secondary"}
      className={
        paid
          ? "text-[10px] bg-green-600 hover:bg-green-600"
          : "text-[10px] bg-amber-500 hover:bg-amber-500 text-white"
      }
    >
      {paid ? "Paid" : "Pending"}
    </Badge>
  );
}
