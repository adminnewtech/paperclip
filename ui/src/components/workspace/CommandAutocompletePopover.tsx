import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspaceApi } from "@/api/workspace";
import { cn } from "@/lib/utils";

export interface CommandAutocompletePopoverProps {
  companyId: string;
  open: boolean;
  prefix: string;
  selectedIndex: number;
  onSelectionChange: (index: number, total: number) => void;
  onPick: (commandName: string) => void;
  lang?: "en" | "ar";
}

export function CommandAutocompletePopover({
  companyId,
  open,
  prefix,
  selectedIndex,
  onSelectionChange,
  onPick,
  lang = "en",
}: CommandAutocompletePopoverProps) {
  const query = useQuery({
    queryKey: ["workspace", companyId, "command-autocomplete", prefix],
    queryFn: () => workspaceApi.commands.autocomplete(companyId, prefix),
    enabled: open && !!companyId,
  });

  const results = query.data?.results ?? [];

  useEffect(() => {
    onSelectionChange(0, results.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length, prefix]);

  if (!open || results.length === 0) return null;

  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 z-30 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
      <div className="border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {lang === "ar" ? "أوامر" : "Commands"}
      </div>
      <ul role="listbox">
        {results.map((cmd, i) => {
          const description = lang === "ar" && cmd.descriptionAr ? cmd.descriptionAr : cmd.description;
          return (
            <li
              key={cmd.name}
              role="option"
              aria-selected={i === selectedIndex}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm",
                i === selectedIndex ? "bg-accent" : "hover:bg-accent/60",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(cmd.name);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">
                  /{cmd.name}
                </span>
                {cmd.category ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {cmd.category}
                  </span>
                ) : null}
              </div>
              {description ? (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
