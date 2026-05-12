import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Lock, TrendingUp } from "lucide-react";
import { Link } from "@/lib/router";
import type {
  BalanceSheet,
  CashFlowStatement,
  IncomeStatement,
  StatementLine,
  TrialBalanceRow,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { businessAccountingApi } from "../api/business-accounting";

function formatCurrency(cents: number, currency = "KWD"): string {
  try {
    return (cents / 100).toLocaleString(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const text = rows.map((r) => r.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Line components
// ---------------------------------------------------------------------------

function ReportLineRow({
  line,
  indent = 0,
  bold = false,
}: {
  line: { name: string; amountCents: number };
  indent?: number;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-1.5 text-sm ${
        bold ? "font-semibold border-t mt-1 pt-2" : ""
      }`}
      style={{ paddingLeft: 16 + indent * 16 }}
    >
      <span>{line.name}</span>
      <span className="font-mono tabular-nums">
        {formatCurrency(line.amountCents)}
      </span>
    </div>
  );
}

function Section({
  title,
  lines,
  totalLabel,
  totalCents,
}: {
  title: string;
  lines: StatementLine[];
  totalLabel: string;
  totalCents: number;
}) {
  return (
    <div className="border rounded-md mb-3">
      <div className="px-4 py-2 bg-muted font-semibold text-xs uppercase tracking-wider">
        {title}
      </div>
      {lines.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">No items</div>
      ) : (
        lines.map((l) => <ReportLineRow key={l.accountCode} line={l} indent={1} />)
      )}
      <ReportLineRow
        line={{ name: totalLabel, amountCents: totalCents }}
        bold
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Income statement
// ---------------------------------------------------------------------------

function IncomeStatementView({ data }: { data: IncomeStatement }) {
  return (
    <div className="bg-card border rounded-lg p-4 space-y-1">
      <div className="text-center pb-2 border-b">
        <h2 className="text-lg font-semibold">Income Statement</h2>
        <p className="text-xs text-muted-foreground">
          For the period {data.periodFrom} → {data.periodTo}
        </p>
      </div>
      <div className="pt-3">
        <Section
          title="Revenue"
          lines={data.revenue}
          totalLabel="Total Revenue"
          totalCents={data.totalRevenueCents}
        />
        {data.cogs.length > 0 && (
          <Section
            title="Cost of Goods Sold"
            lines={data.cogs}
            totalLabel="Total COGS"
            totalCents={data.totalCogsCents}
          />
        )}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 text-sm font-semibold">
          <span>Gross Profit</span>
          <span className="font-mono tabular-nums">
            {formatCurrency(data.grossProfitCents)}
          </span>
        </div>
        <Section
          title="Operating Expenses"
          lines={data.expenses}
          totalLabel="Total Expenses"
          totalCents={data.totalExpensesCents}
        />
        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 text-sm font-semibold">
          <span>Operating Income</span>
          <span className="font-mono tabular-nums">
            {formatCurrency(data.operatingIncomeCents)}
          </span>
        </div>
        {(data.otherIncome.length > 0 || data.otherExpenses.length > 0) && (
          <>
            {data.otherIncome.length > 0 && (
              <Section
                title="Other Income"
                lines={data.otherIncome}
                totalLabel="Total Other Income"
                totalCents={data.otherIncome.reduce(
                  (s, l) => s + l.amountCents,
                  0,
                )}
              />
            )}
            {data.otherExpenses.length > 0 && (
              <Section
                title="Other Expenses"
                lines={data.otherExpenses}
                totalLabel="Total Other Expenses"
                totalCents={data.otherExpenses.reduce(
                  (s, l) => s + l.amountCents,
                  0,
                )}
              />
            )}
          </>
        )}
        <div
          className={`flex items-center justify-between px-4 py-3 mt-2 rounded-md text-base font-bold ${
            data.netIncomeCents >= 0
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300"
          }`}
        >
          <span>Net Income</span>
          <span className="font-mono tabular-nums">
            {formatCurrency(data.netIncomeCents)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------

function BalanceSheetView({ data }: { data: BalanceSheet }) {
  return (
    <div className="bg-card border rounded-lg p-4 space-y-1">
      <div className="text-center pb-2 border-b">
        <h2 className="text-lg font-semibold">Balance Sheet</h2>
        <p className="text-xs text-muted-foreground">As of {data.asOfDate}</p>
      </div>
      <div className="pt-3">
        <Section
          title="Current Assets"
          lines={data.assets.currentAssets}
          totalLabel="Total Current Assets"
          totalCents={data.assets.totalCurrentAssetsCents}
        />
        {data.assets.fixedAssets.length > 0 && (
          <Section
            title="Fixed Assets"
            lines={data.assets.fixedAssets}
            totalLabel="Total Fixed Assets"
            totalCents={data.assets.totalFixedAssetsCents}
          />
        )}
        {data.assets.otherAssets.length > 0 && (
          <Section
            title="Other Assets"
            lines={data.assets.otherAssets}
            totalLabel="Total Other Assets"
            totalCents={data.assets.otherAssets.reduce(
              (s, l) => s + l.amountCents,
              0,
            )}
          />
        )}
        <div className="flex items-center justify-between px-4 py-2 bg-blue-50 dark:bg-blue-950/30 text-sm font-bold">
          <span>Total Assets</span>
          <span className="font-mono tabular-nums">
            {formatCurrency(data.assets.totalAssetsCents)}
          </span>
        </div>

        <div className="mt-4">
          <Section
            title="Current Liabilities"
            lines={data.liabilities.currentLiabilities}
            totalLabel="Total Current Liabilities"
            totalCents={data.liabilities.totalCurrentLiabilitiesCents}
          />
          {data.liabilities.longTermLiabilities.length > 0 && (
            <Section
              title="Long-term Liabilities"
              lines={data.liabilities.longTermLiabilities}
              totalLabel="Total Long-term Liabilities"
              totalCents={data.liabilities.longTermLiabilities.reduce(
                (s, l) => s + l.amountCents,
                0,
              )}
            />
          )}
          <div className="flex items-center justify-between px-4 py-2 bg-amber-50 dark:bg-amber-950/30 text-sm font-bold">
            <span>Total Liabilities</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(data.liabilities.totalLiabilitiesCents)}
            </span>
          </div>
        </div>

        <div className="mt-4">
          <Section
            title="Equity"
            lines={data.equity.items}
            totalLabel="Total Equity"
            totalCents={data.equity.totalEquityCents}
          />
        </div>

        <div className="flex items-center justify-between px-4 py-3 mt-3 rounded-md bg-purple-50 dark:bg-purple-950/30 text-base font-bold">
          <span>Total Liabilities + Equity</span>
          <span className="font-mono tabular-nums">
            {formatCurrency(data.totalLiabilitiesAndEquityCents)}
          </span>
        </div>
        <div className="px-4 py-1 text-[11px] text-muted-foreground">
          Balanced:{" "}
          {data.assets.totalAssetsCents === data.totalLiabilitiesAndEquityCents
            ? "Yes"
            : `No (Δ ${formatCurrency(
                data.assets.totalAssetsCents - data.totalLiabilitiesAndEquityCents,
              )})`}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

function CashFlowView({ data }: { data: CashFlowStatement }) {
  return (
    <div className="bg-card border rounded-lg p-4 space-y-1">
      <div className="text-center pb-2 border-b">
        <h2 className="text-lg font-semibold">Cash Flow Statement</h2>
        <p className="text-xs text-muted-foreground">
          For the period {data.periodFrom} → {data.periodTo} (indirect method)
        </p>
      </div>
      <div className="pt-3 space-y-3">
        <div className="border rounded-md">
          <div className="px-4 py-2 bg-muted font-semibold text-xs uppercase tracking-wider">
            Operating Activities
          </div>
          {data.operating.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">No items</div>
          ) : (
            data.operating.map((l, i) => (
              <ReportLineRow
                key={i}
                line={{ name: l.description, amountCents: l.amountCents }}
                indent={1}
              />
            ))
          )}
          <div className="flex items-center justify-between px-4 py-2 bg-muted/50 text-sm font-semibold">
            <span>Net Cash from Operating</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(data.netOperatingCents)}
            </span>
          </div>
        </div>

        <div className="border rounded-md">
          <div className="px-4 py-2 bg-muted font-semibold text-xs uppercase tracking-wider">
            Investing Activities
          </div>
          {data.investing.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">No items</div>
          ) : (
            data.investing.map((l, i) => (
              <ReportLineRow
                key={i}
                line={{ name: l.description, amountCents: l.amountCents }}
                indent={1}
              />
            ))
          )}
          <div className="flex items-center justify-between px-4 py-2 bg-muted/50 text-sm font-semibold">
            <span>Net Cash from Investing</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(data.netInvestingCents)}
            </span>
          </div>
        </div>

        <div className="border rounded-md">
          <div className="px-4 py-2 bg-muted font-semibold text-xs uppercase tracking-wider">
            Financing Activities
          </div>
          {data.financing.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">No items</div>
          ) : (
            data.financing.map((l, i) => (
              <ReportLineRow
                key={i}
                line={{ name: l.description, amountCents: l.amountCents }}
                indent={1}
              />
            ))
          )}
          <div className="flex items-center justify-between px-4 py-2 bg-muted/50 text-sm font-semibold">
            <span>Net Cash from Financing</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(data.netFinancingCents)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 rounded-md bg-purple-50 dark:bg-purple-950/30 text-base font-bold">
          <span>Net Change in Cash</span>
          <span className="font-mono tabular-nums">
            {formatCurrency(data.netChangeInCashCents)}
          </span>
        </div>
        <div className="px-4 py-1 grid grid-cols-2 text-xs text-muted-foreground">
          <span>Beginning Cash: {formatCurrency(data.beginningCashCents)}</span>
          <span className="text-right">
            Ending Cash: {formatCurrency(data.endingCashCents)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

function TrialBalanceView({
  rows,
  totalDebit,
  totalCredit,
  asOf,
  balanced,
}: {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  asOf: string;
  balanced: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        message="No accounts yet. Seed your Chart of Accounts to see a trial balance."
      />
    );
  }
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="text-center pb-3 border-b">
        <h2 className="text-lg font-semibold">Trial Balance</h2>
        <p className="text-xs text-muted-foreground">As of {asOf}</p>
      </div>
      <table className="w-full text-sm mt-3">
        <thead className="bg-muted">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium">Code</th>
            <th className="px-3 py-2 text-left text-xs font-medium">Account</th>
            <th className="px-3 py-2 text-left text-xs font-medium">Type</th>
            <th className="px-3 py-2 text-right text-xs font-medium">Debit</th>
            <th className="px-3 py-2 text-right text-xs font-medium">Credit</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.accountCode}>
              <td className="px-3 py-1.5 text-xs font-mono">{r.accountCode}</td>
              <td className="px-3 py-1.5 text-xs">{r.accountName}</td>
              <td className="px-3 py-1.5 text-xs capitalize">{r.accountType}</td>
              <td className="px-3 py-1.5 text-xs font-mono text-right tabular-nums">
                {r.debitCents ? formatCurrency(r.debitCents) : ""}
              </td>
              <td className="px-3 py-1.5 text-xs font-mono text-right tabular-nums">
                {r.creditCents ? formatCurrency(r.creditCents) : ""}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td colSpan={3} className="px-3 py-2 text-right text-xs">
              Totals
            </td>
            <td className="px-3 py-2 text-xs font-mono text-right tabular-nums">
              {formatCurrency(totalDebit)}
            </td>
            <td className="px-3 py-2 text-xs font-mono text-right tabular-nums">
              {formatCurrency(totalCredit)}
            </td>
          </tr>
        </tfoot>
      </table>
      <div
        className={`mt-2 text-xs text-right ${
          balanced ? "text-emerald-700" : "text-destructive"
        }`}
      >
        {balanced ? "Trial balance is balanced." : "Trial balance is NOT balanced."}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessFinancialStatementsPage() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState("income");
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [asOf, setAsOf] = useState(todayIso());
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Accounting", href: "/business/accounting" },
      { label: "Financial Statements" },
    ]);
  }, [setBreadcrumbs]);

  const incomeQuery = useQuery({
    queryKey: [
      "business-accounting",
      "income-statement",
      selectedCompanyId,
      from,
      to,
    ],
    queryFn: () =>
      businessAccountingApi.incomeStatement(selectedCompanyId!, from, to),
    enabled: !!selectedCompanyId && tab === "income",
  });

  const bsQuery = useQuery({
    queryKey: ["business-accounting", "balance-sheet", selectedCompanyId, asOf],
    queryFn: () => businessAccountingApi.balanceSheet(selectedCompanyId!, asOf),
    enabled: !!selectedCompanyId && tab === "balance",
  });

  const cfQuery = useQuery({
    queryKey: ["business-accounting", "cash-flow", selectedCompanyId, from, to],
    queryFn: () => businessAccountingApi.cashFlow(selectedCompanyId!, from, to),
    enabled: !!selectedCompanyId && tab === "cashflow",
  });

  const tbQuery = useQuery({
    queryKey: ["business-accounting", "trial-balance", selectedCompanyId, asOf],
    queryFn: () => businessAccountingApi.trialBalance(selectedCompanyId!, asOf),
    enabled: !!selectedCompanyId && tab === "trial",
  });

  const closePeriod = useMutation({
    mutationFn: () => businessAccountingApi.closePeriod(selectedCompanyId!, to),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["business-accounting"],
      });
    },
  });

  const showPeriod = tab === "income" || tab === "cashflow";
  const showAsOf = tab === "balance" || tab === "trial";

  const csvForActive = useMemo(() => {
    return () => {
      if (tab === "income" && incomeQuery.data) {
        const d = incomeQuery.data;
        const rows: Array<Array<string | number>> = [
          ["Income Statement", `${d.periodFrom} → ${d.periodTo}`],
          [],
          ["Section", "Account", "Amount (cents)"],
        ];
        for (const r of d.revenue)
          rows.push(["Revenue", `${r.accountCode} ${r.name}`, r.amountCents]);
        rows.push(["Revenue", "Total Revenue", d.totalRevenueCents]);
        for (const r of d.cogs)
          rows.push(["COGS", `${r.accountCode} ${r.name}`, r.amountCents]);
        rows.push(["COGS", "Total COGS", d.totalCogsCents]);
        rows.push(["", "Gross Profit", d.grossProfitCents]);
        for (const r of d.expenses)
          rows.push(["Expenses", `${r.accountCode} ${r.name}`, r.amountCents]);
        rows.push(["Expenses", "Total Expenses", d.totalExpensesCents]);
        rows.push(["", "Operating Income", d.operatingIncomeCents]);
        rows.push(["", "Net Income", d.netIncomeCents]);
        downloadCsv(`income-statement_${d.periodFrom}_${d.periodTo}.csv`, rows);
      } else if (tab === "balance" && bsQuery.data) {
        const d = bsQuery.data;
        const rows: Array<Array<string | number>> = [
          ["Balance Sheet", `As of ${d.asOfDate}`],
          [],
          ["Section", "Account", "Amount (cents)"],
        ];
        for (const r of d.assets.currentAssets)
          rows.push(["Current Assets", `${r.accountCode} ${r.name}`, r.amountCents]);
        for (const r of d.assets.fixedAssets)
          rows.push(["Fixed Assets", `${r.accountCode} ${r.name}`, r.amountCents]);
        rows.push(["", "Total Assets", d.assets.totalAssetsCents]);
        for (const r of d.liabilities.currentLiabilities)
          rows.push(["Current Liabilities", `${r.accountCode} ${r.name}`, r.amountCents]);
        for (const r of d.liabilities.longTermLiabilities)
          rows.push([
            "Long-term Liabilities",
            `${r.accountCode} ${r.name}`,
            r.amountCents,
          ]);
        rows.push(["", "Total Liabilities", d.liabilities.totalLiabilitiesCents]);
        for (const r of d.equity.items)
          rows.push(["Equity", `${r.accountCode} ${r.name}`, r.amountCents]);
        rows.push(["", "Total Equity", d.equity.totalEquityCents]);
        rows.push([
          "",
          "Total Liabilities + Equity",
          d.totalLiabilitiesAndEquityCents,
        ]);
        downloadCsv(`balance-sheet_${d.asOfDate}.csv`, rows);
      } else if (tab === "cashflow" && cfQuery.data) {
        const d = cfQuery.data;
        const rows: Array<Array<string | number>> = [
          ["Cash Flow", `${d.periodFrom} → ${d.periodTo}`],
          [],
          ["Section", "Description", "Amount (cents)"],
        ];
        for (const r of d.operating)
          rows.push(["Operating", r.description, r.amountCents]);
        rows.push(["", "Net Operating", d.netOperatingCents]);
        for (const r of d.investing)
          rows.push(["Investing", r.description, r.amountCents]);
        rows.push(["", "Net Investing", d.netInvestingCents]);
        for (const r of d.financing)
          rows.push(["Financing", r.description, r.amountCents]);
        rows.push(["", "Net Financing", d.netFinancingCents]);
        rows.push(["", "Net Change in Cash", d.netChangeInCashCents]);
        downloadCsv(`cash-flow_${d.periodFrom}_${d.periodTo}.csv`, rows);
      } else if (tab === "trial" && tbQuery.data) {
        const d = tbQuery.data;
        const rows: Array<Array<string | number>> = [
          ["Trial Balance", `As of ${d.asOf}`],
          [],
          ["Code", "Account", "Type", "Debit (cents)", "Credit (cents)"],
          ...d.rows.map((r) => [
            r.accountCode,
            r.accountName,
            r.accountType,
            r.debitCents,
            r.creditCents,
          ]),
          ["", "Totals", "", d.totalDebitCents, d.totalCreditCents],
        ];
        downloadCsv(`trial-balance_${d.asOf}.csv`, rows);
      }
    };
  }, [tab, incomeQuery.data, bsQuery.data, cfQuery.data, tbQuery.data]);

  if (!selectedCompanyId) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/business/accounting">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Financial Statements</h1>
          <p className="text-sm text-muted-foreground">
            P&L, Balance Sheet, Cash Flow, Trial Balance.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={csvForActive}>
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showPeriod && (
          <>
            <span className="text-xs text-muted-foreground">From</span>
            <Input
              type="date"
              value={from}
              className="w-auto"
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={to}
              className="w-auto"
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        )}
        {showAsOf && (
          <>
            <span className="text-xs text-muted-foreground">As of</span>
            <Input
              type="date"
              value={asOf}
              className="w-auto"
              onChange={(e) => setAsOf(e.target.value)}
            />
          </>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="income">Income Statement</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
          <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
          <TabsTrigger value="trial">Trial Balance</TabsTrigger>
        </TabsList>
        <TabsContent value="income" className="mt-4">
          {incomeQuery.data ? (
            <IncomeStatementView data={incomeQuery.data} />
          ) : (
            <EmptyState icon={TrendingUp} message="Loading…" />
          )}
        </TabsContent>
        <TabsContent value="balance" className="mt-4">
          {bsQuery.data ? (
            <BalanceSheetView data={bsQuery.data} />
          ) : (
            <EmptyState icon={TrendingUp} message="Loading…" />
          )}
        </TabsContent>
        <TabsContent value="cashflow" className="mt-4">
          {cfQuery.data ? (
            <CashFlowView data={cfQuery.data} />
          ) : (
            <EmptyState icon={TrendingUp} message="Loading…" />
          )}
        </TabsContent>
        <TabsContent value="trial" className="mt-4">
          {tbQuery.data ? (
            <TrialBalanceView
              rows={tbQuery.data.rows}
              totalDebit={tbQuery.data.totalDebitCents}
              totalCredit={tbQuery.data.totalCreditCents}
              asOf={tbQuery.data.asOf}
              balanced={tbQuery.data.balanced}
            />
          ) : (
            <EmptyState icon={TrendingUp} message="Loading…" />
          )}
        </TabsContent>
      </Tabs>

      <div className="border rounded-md p-4 bg-card">
        <div className="flex items-center gap-3">
          <Lock className="h-5 w-5 text-amber-600" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Close Accounting Period</h3>
            <p className="text-xs text-muted-foreground">
              Closing rolls revenue & expense balances into retained earnings as
              of {to}.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={closePeriod.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Close the accounting period ending ${to}? This creates a posted journal entry.`,
                )
              ) {
                closePeriod.mutate();
              }
            }}
          >
            {closePeriod.isPending ? "Closing…" : "Close Period"}
          </Button>
        </div>
        {closePeriod.data && (
          <p className="mt-2 text-xs text-emerald-700">
            Period closed. Net income posted to retained earnings:{" "}
            {formatCurrency(closePeriod.data.netIncomeCents)}.
          </p>
        )}
        {closePeriod.error && (
          <p className="mt-2 text-xs text-destructive">
            {(closePeriod.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
