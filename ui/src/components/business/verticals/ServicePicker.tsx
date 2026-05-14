import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SalonServiceEntity } from "../../../api/business-salons";

interface ServicePickerProps {
  services: SalonServiceEntity[];
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function formatPrice(cents: number): string {
  // KWD has 3 decimals — using "fils" as cents-equivalent.
  return `${(cents / 1000).toFixed(3)} KWD`;
}

export function ServicePicker({
  services,
  value,
  onChange,
  disabled,
  placeholder = "Choose a service…",
}: ServicePickerProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, SalonServiceEntity[]>();
    for (const s of services) {
      const key = s.category || "Other";
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [services]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {grouped.map(([category, list]) => (
          <div key={category} className="px-2 py-1">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {category}
            </div>
            {list.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="flex items-center justify-between gap-3">
                  <span>{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.durationMinutes}m · {formatPrice(s.priceCents)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}
