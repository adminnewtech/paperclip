import { useMemo } from "react";
import { Check, CreditCard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  PaymentProviderName,
  ProviderDescriptor,
} from "../../api/business-payments";

interface PaymentMethodPickerProps {
  availableProviders: ProviderDescriptor[];
  amountCents: number;
  currency: string;
  selected?: PaymentProviderName;
  onSelect: (provider: PaymentProviderName) => void;
}

const PROVIDER_LABELS: Record<PaymentProviderName, { name: string; tagline: string; emoji: string }> = {
  knet: { name: "KNET", tagline: "Kuwait debit", emoji: "🇰🇼" },
  myfatoorah: { name: "MyFatoorah", tagline: "All GCC methods", emoji: "💳" },
  moyasar: { name: "Moyasar", tagline: "Mada · Apple Pay", emoji: "🇸🇦" },
  tap: { name: "Tap", tagline: "GCC unified", emoji: "🌍" },
  paytabs: { name: "PayTabs", tagline: "UAE · Saudi", emoji: "🇦🇪" },
  stripe: { name: "Stripe", tagline: "International", emoji: "🌐" },
  mock: { name: "Sandbox", tagline: "Test mode", emoji: "🧪" },
};

function formatAmount(amountCents: number, currency: string): string {
  const decimals = ["KWD", "BHD", "OMR"].includes(currency) ? 3 : 2;
  return `${(amountCents / Math.pow(10, decimals)).toFixed(decimals)} ${currency}`;
}

export function PaymentMethodPicker({
  availableProviders,
  amountCents,
  currency,
  selected,
  onSelect,
}: PaymentMethodPickerProps) {
  const eligible = useMemo(
    () =>
      availableProviders.filter(
        (p) => p.configured && p.currencies.includes(currency),
      ),
    [availableProviders, currency],
  );

  if (eligible.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-center">
        <CreditCard className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm font-medium">No payment methods available</p>
        <p className="text-xs text-muted-foreground mt-1">
          No configured providers support {currency}. Configure one in
          Business → Payments.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Choose payment method</p>
        <p className="text-sm font-mono tabular-nums">
          {formatAmount(amountCents, currency)}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {eligible.map((p) => {
          const label = PROVIDER_LABELS[p.name];
          const isSelected = selected === p.name;
          return (
            <Card
              key={p.name}
              className={`cursor-pointer transition ${
                isSelected
                  ? "ring-2 ring-primary border-primary"
                  : "hover:border-muted-foreground/40"
              }`}
              onClick={() => onSelect(p.name)}
            >
              <CardContent className="p-3 flex items-center gap-3">
                <div className="text-2xl shrink-0" aria-hidden>
                  {label.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold truncate">{label.name}</p>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {label.tagline}
                  </p>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {currency}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
