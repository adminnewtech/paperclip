import {
  GCC_CURRENCIES,
  GCC_CURRENCY_CODES,
  GCC_COUNTRIES,
  type GccCurrency,
} from "@paperclipai/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CurrencySelectProps {
  value: GccCurrency;
  onChange: (value: GccCurrency) => void;
  disabled?: boolean;
  className?: string;
}

// Map currency to its primary country (for the flag emoji).
const CURRENCY_TO_COUNTRY_FLAG: Record<GccCurrency, string> = {
  KWD: GCC_COUNTRIES.KW.flag,
  SAR: GCC_COUNTRIES.SA.flag,
  AED: GCC_COUNTRIES.AE.flag,
  QAR: GCC_COUNTRIES.QA.flag,
  BHD: GCC_COUNTRIES.BH.flag,
  OMR: GCC_COUNTRIES.OM.flag,
};

export function CurrencySelect({
  value,
  onChange,
  disabled,
  className,
}: CurrencySelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as GccCurrency)}
      disabled={disabled}
    >
      <SelectTrigger className={className} aria-label="Currency">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GCC_CURRENCY_CODES.map((code) => {
          const info = GCC_CURRENCIES[code];
          return (
            <SelectItem key={code} value={code}>
              <span aria-hidden="true">{CURRENCY_TO_COUNTRY_FLAG[code]}</span>
              <span className="font-medium">{code}</span>
              <span className="text-muted-foreground">{info.name}</span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export default CurrencySelect;
