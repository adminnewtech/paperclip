// ---------------------------------------------------------------------------
// BankConnectDialog
// ---------------------------------------------------------------------------
//
// Walks the user through linking a bank account:
//   1. Pick a connector (CBK Kuwait / SAMA Saudi / UAE OBA / Plaid / Mock)
//   2. Confirm redirect URL and launch the OAuth flow in a popup
//   3. After the bank redirects back, show the linked accounts
//
// The "Mock" connector skips OAuth and finalizes the consent server-side in
// one round-trip — used for demos and dev.

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  businessBankingApi,
  type BankConnectorName,
  type ConnectorDescriptor,
} from "../../api/business-banking";

const CONNECTOR_LABEL: Record<BankConnectorName, string> = {
  cbk_kuwait: "CBK Kuwait Open Banking",
  sama_saudi: "SAMA Saudi Open Banking",
  uae_oba: "UAE Open Banking",
  plaid: "Plaid (international)",
  mock: "Mock (demo data)",
};

const CONNECTOR_FLAG: Record<BankConnectorName, string> = {
  cbk_kuwait: "KW",
  sama_saudi: "SA",
  uae_oba: "AE",
  plaid: "US",
  mock: "—",
};

const CONNECTOR_DESCRIPTION: Record<BankConnectorName, string> = {
  cbk_kuwait:
    "OAuth 2.0 / FAPI consent flow with Kuwaiti retail banks via the CBK Open Banking Framework.",
  sama_saudi:
    "Saudi Arabian Monetary Authority Open Banking Framework — AISP read access.",
  uae_oba:
    "Central Bank of the UAE Open Banking Framework (sandbox: falls back to mock).",
  plaid:
    "International Link-token flow. Use for US/CA/UK testing in development.",
  mock:
    "Pre-populated demo accounts and transactions — no OAuth, no credentials required.",
};

interface BankConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

type Step = "pick" | "launching" | "done";

export function BankConnectDialog({
  open,
  onOpenChange,
  companyId,
}: BankConnectDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<BankConnectorName>("mock");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [autoCompleted, setAutoCompleted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const connectorsQuery = useQuery({
    queryKey: ["business-banking-connectors", companyId],
    queryFn: () => businessBankingApi.listConnectors(companyId),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setStep("pick");
      setAuthUrl(null);
      setAutoCompleted(false);
      setErrorMsg(null);
    }
  }, [open]);

  const connectMutation = useMutation({
    mutationFn: async (connector: BankConnectorName) => {
      setErrorMsg(null);
      const redirectUrl = `${window.location.origin}${window.location.pathname}`;
      return businessBankingApi.connect(companyId, {
        connector,
        redirectUrl,
      });
    },
    onSuccess: (data) => {
      setAuthUrl(data.authUrl);
      setAutoCompleted(data.autoCompleted);
      setStep(data.autoCompleted ? "done" : "launching");
      if (data.autoCompleted) {
        queryClient.invalidateQueries({
          queryKey: ["business-banking-accounts", companyId],
        });
        queryClient.invalidateQueries({
          queryKey: ["business-banking-transactions", companyId],
        });
      }
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    },
  });

  const connectors = connectorsQuery.data?.connectors ?? [];

  const sortedConnectors = useMemo(() => {
    // Surface "mock" last so real connectors are picked first.
    return [...connectors].sort((a, b) => {
      if (a.name === "mock") return 1;
      if (b.name === "mock") return -1;
      return a.name.localeCompare(b.name);
    });
  }, [connectors]);

  function launchOauth() {
    if (!authUrl) return;
    window.open(authUrl, "_blank", "noopener,noreferrer,width=720,height=820");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Connect a bank
          </DialogTitle>
        </DialogHeader>

        {errorMsg ? (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        {step === "pick" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Choose your Open Banking provider. We use read-only consent — we
              never see your password, and you can revoke access at any time.
            </p>
            <div className="grid gap-2">
              {sortedConnectors.map((c) => (
                <ConnectorOption
                  key={c.name}
                  connector={c}
                  selected={selected === c.name}
                  onSelect={() => setSelected(c.name)}
                />
              ))}
              {connectorsQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === "launching" ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium">Redirect securely to your bank</p>
                <p className="mt-0.5 text-muted-foreground">
                  A new window will open at{" "}
                  <code className="font-mono text-[10px]">
                    {authUrl?.split("?")[0]}
                  </code>{" "}
                  where you log in and approve the connection.
                </p>
              </div>
            </div>
            <Button onClick={launchOauth} className="w-full" size="sm">
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Open consent window
            </Button>
            <p className="text-[11px] text-muted-foreground">
              After approving, this window will refresh and show your linked
              accounts. (If your popup blocker intervened, copy the link
              manually.)
            </p>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  {autoCompleted ? "Demo accounts linked" : "Bank connected"}
                </p>
                <p className="mt-0.5 opacity-80">
                  {autoCompleted
                    ? "We populated your workspace with realistic Kuwaiti merchant data. You can now reconcile sample transactions."
                    : "Your bank successfully shared access. Sync to load transactions."}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {step === "done" ? "Done" : "Cancel"}
          </Button>
          {step === "pick" ? (
            <Button
              size="sm"
              onClick={() => connectMutation.mutate(selected)}
              disabled={connectMutation.isPending}
            >
              {connectMutation.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Connect
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectorOption({
  connector,
  selected,
  onSelect,
}: {
  connector: ConnectorDescriptor;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/40"
          : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base">{CONNECTOR_FLAG[connector.name]}</span>
          <span className="text-sm font-medium">
            {CONNECTOR_LABEL[connector.name]}
          </span>
          {connector.configured ? (
            <Badge variant="secondary" className="text-[10px]">
              configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              demo / mock
            </Badge>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {CONNECTOR_DESCRIPTION[connector.name]}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Countries: {connector.countries.join(", ")}
        </p>
      </div>
    </button>
  );
}
