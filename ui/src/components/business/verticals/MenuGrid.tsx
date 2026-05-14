import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  formatKwd,
  type MenuItem,
} from "../../../api/business-restaurants";

interface MenuGridProps {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
  disabled?: boolean;
}

/**
 * Touch-friendly grid of menu items, grouped by category tabs at the top.
 * Designed for use on the right side of the POS screen.
 */
export function MenuGrid({ items, onSelect, disabled }: MenuGridProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add(item.category);
    return Array.from(set);
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCategory && item.category !== activeCategory) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.nameAr.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q)
      );
    });
  }, [items, search, activeCategory]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu…"
            className="pl-9 h-11 text-base"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={activeCategory === null ? "default" : "outline"}
            onClick={() => setActiveCategory(null)}
            className="h-9"
          >
            All
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              size="sm"
              variant={activeCategory === cat ? "default" : "outline"}
              onClick={() => setActiveCategory(cat)}
              className="h-9"
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No menu items match.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={disabled || !item.isAvailable}
                onClick={() => onSelect(item)}
                className="group relative flex aspect-square flex-col items-stretch justify-between rounded-lg border bg-card p-3 text-left shadow-sm transition hover:border-primary hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex-1 space-y-1">
                  <div className="text-sm font-semibold leading-tight line-clamp-2">
                    {item.name}
                  </div>
                  {item.nameAr ? (
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {item.nameAr}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-base font-bold tabular-nums">
                    {formatKwd(item.priceCents)}
                  </span>
                  {!item.isAvailable ? (
                    <Badge variant="outline" className="text-[10px]">
                      Out
                    </Badge>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
