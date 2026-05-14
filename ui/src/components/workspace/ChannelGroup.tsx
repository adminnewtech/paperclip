import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChannelGroupProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

export function ChannelGroup({
  title,
  count,
  defaultOpen = true,
  action,
  children,
}: ChannelGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1 rounded px-1 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              open && "rotate-90",
            )}
          />
          <span>{title}</span>
          {typeof count === "number" ? (
            <span className="text-[10px] text-muted-foreground/70">
              {count}
            </span>
          ) : null}
        </button>
        {action}
      </div>
      {open ? <div className="space-y-0.5">{children}</div> : null}
    </div>
  );
}
