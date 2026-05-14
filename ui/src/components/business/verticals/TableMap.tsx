import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Badge } from "@/components/ui/badge";
import type { Table } from "../../../api/business-restaurants";

interface TableMapProps {
  tables: Table[];
  onSelect?: (table: Table) => void;
  onMove?: (table: Table, position: { x: number; y: number }) => void;
  editable?: boolean;
}

const STATUS_STYLES: Record<Table["status"], { bg: string; text: string }> = {
  available: { bg: "bg-emerald-100 dark:bg-emerald-900", text: "text-emerald-900 dark:text-emerald-100" },
  occupied: { bg: "bg-rose-100 dark:bg-rose-900", text: "text-rose-900 dark:text-rose-100" },
  reserved: { bg: "bg-amber-100 dark:bg-amber-900", text: "text-amber-900 dark:text-amber-100" },
  cleaning: { bg: "bg-slate-200 dark:bg-slate-800", text: "text-slate-900 dark:text-slate-100" },
};

const AREA_LABEL: Record<Table["area"], string> = {
  main: "Main",
  outdoor: "Patio",
  vip: "VIP",
  bar: "Bar",
};

function tableSize(capacity: number): number {
  if (capacity <= 2) return 80;
  if (capacity <= 4) return 100;
  if (capacity <= 6) return 120;
  return 140;
}

/**
 * Visual draggable canvas of tables. When editable=true, tables can be
 * repositioned by drag; otherwise they're click-to-select.
 */
export function TableMap({
  tables,
  onSelect,
  onMove,
  editable = false,
}: TableMapProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
    x: number;
    y: number;
  } | null>(null);

  function handlePointerDown(
    e: ReactPointerEvent<HTMLButtonElement>,
    table: Table,
  ) {
    if (!editable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pos = table.position ?? { x: 60, y: 60 };
    setDragging({
      id: table.id,
      offsetX: e.clientX - rect.left - pos.x,
      offsetY: e.clientY - rect.top - pos.y,
      x: pos.x,
      y: pos.y,
    });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragging({
      ...dragging,
      x: Math.max(0, e.clientX - rect.left - dragging.offsetX),
      y: Math.max(0, e.clientY - rect.top - dragging.offsetY),
    });
  }

  function handlePointerUp(table: Table) {
    if (!dragging || dragging.id !== table.id) return;
    onMove?.(table, { x: dragging.x, y: dragging.y });
    setDragging(null);
  }

  return (
    <div
      ref={canvasRef}
      className="relative h-[600px] w-full overflow-auto rounded-lg border bg-muted/30"
      style={{ minWidth: "800px" }}
    >
      {tables.map((table) => {
        const isDragging = dragging?.id === table.id;
        const pos = isDragging
          ? { x: dragging!.x, y: dragging!.y }
          : table.position ?? { x: 60, y: 60 };
        const size = tableSize(table.capacity);
        const style = STATUS_STYLES[table.status];
        return (
          <button
            key={table.id}
            type="button"
            onPointerDown={(e) => handlePointerDown(e, table)}
            onPointerMove={handlePointerMove}
            onPointerUp={() => handlePointerUp(table)}
            onClick={() => {
              if (!isDragging) onSelect?.(table);
            }}
            className={`absolute flex flex-col items-center justify-center rounded-2xl border-2 shadow-sm transition ${style.bg} ${style.text} ${
              editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
            } hover:scale-[1.02] hover:shadow-md`}
            style={{
              left: pos.x,
              top: pos.y,
              width: size,
              height: size,
              touchAction: editable ? "none" : undefined,
            }}
            title={`${table.name} · ${table.capacity} seats · ${table.status}`}
          >
            <span className="text-base font-bold leading-tight">
              {table.name}
            </span>
            <span className="text-xs opacity-80">
              {table.capacity} seats
            </span>
            <Badge variant="outline" className="mt-1 text-[10px] capitalize">
              {table.status}
            </Badge>
            <span className="absolute top-1 right-2 text-[9px] uppercase opacity-60">
              {AREA_LABEL[table.area]}
            </span>
          </button>
        );
      })}
      {tables.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          No tables yet. Add some to build your layout.
        </div>
      ) : null}
    </div>
  );
}
