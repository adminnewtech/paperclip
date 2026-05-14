import { useMemo } from "react";
import type { Appointment, Stylist } from "../../../api/business-salons";

interface AppointmentCalendarProps {
  date: Date;
  stylists: Stylist[];
  appointments: Appointment[];
  onSlotClick?: (stylistId: string, startAt: Date) => void;
  onAppointmentClick?: (appointment: Appointment) => void;
  /** Hour the salon opens (default 9). */
  openHour?: number;
  /** Hour the salon closes (default 22). */
  closeHour?: number;
  /** Slot resolution in minutes (default 30). */
  slotMinutes?: number;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 border-blue-400 text-blue-900 dark:bg-blue-900/40 dark:border-blue-400 dark:text-blue-100",
  confirmed: "bg-emerald-100 border-emerald-400 text-emerald-900 dark:bg-emerald-900/40 dark:border-emerald-400 dark:text-emerald-100",
  in_progress: "bg-amber-100 border-amber-400 text-amber-900 dark:bg-amber-900/40 dark:border-amber-400 dark:text-amber-100",
  completed: "bg-slate-100 border-slate-400 text-slate-800 dark:bg-slate-800 dark:border-slate-500 dark:text-slate-100",
  cancelled: "bg-rose-100 border-rose-400 text-rose-900 line-through dark:bg-rose-900/40 dark:border-rose-400 dark:text-rose-100",
  no_show: "bg-zinc-200 border-zinc-400 text-zinc-700 line-through dark:bg-zinc-700 dark:border-zinc-500 dark:text-zinc-100",
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatHour(h: number, m: number): string {
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function AppointmentCalendar({
  date,
  stylists,
  appointments,
  onSlotClick,
  onAppointmentClick,
  openHour = 9,
  closeHour = 22,
  slotMinutes = 30,
}: AppointmentCalendarProps) {
  const day = startOfDay(date);

  const slotsPerHour = 60 / slotMinutes;
  const totalSlots = (closeHour - openHour) * slotsPerHour;
  const slotPx = 36; // height of each 30-min slot
  const totalHeight = totalSlots * slotPx;

  const slotIndices = useMemo(
    () => Array.from({ length: totalSlots }, (_, i) => i),
    [totalSlots],
  );

  const appointmentsByStylist = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const start = new Date(a.startAt);
      if (!sameDay(start, day)) continue;
      const list = map.get(a.stylistId) ?? [];
      list.push(a);
      map.set(a.stylistId, list);
    }
    return map;
  }, [appointments, day]);

  function slotOffsetPx(d: Date): number {
    const minutesFromStart =
      (d.getHours() - openHour) * 60 + d.getMinutes();
    return (minutesFromStart / slotMinutes) * slotPx;
  }

  function slotAtIndex(i: number): Date {
    const minutes = i * slotMinutes;
    const slot = new Date(day);
    slot.setHours(openHour, 0, 0, 0);
    slot.setMinutes(slot.getMinutes() + minutes);
    return slot;
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `64px repeat(${Math.max(stylists.length, 1)}, minmax(140px, 1fr))`,
        }}
      >
        {/* Header */}
        <div className="border-b border-r bg-muted/40 px-2 py-2 text-xs font-medium text-muted-foreground">
          Time
        </div>
        {stylists.map((s) => (
          <div
            key={s.id}
            className="border-b border-r bg-muted/40 px-3 py-2 text-sm font-medium last:border-r-0"
          >
            <div className="truncate">{s.name}</div>
            {s.specialties.length > 0 ? (
              <div className="truncate text-[10px] text-muted-foreground">
                {s.specialties.join(", ")}
              </div>
            ) : null}
          </div>
        ))}
        {stylists.length === 0 ? (
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">
            No stylists yet
          </div>
        ) : null}

        {/* Time column */}
        <div
          className="border-r"
          style={{ height: totalHeight, position: "relative" }}
        >
          {slotIndices.map((i) => {
            const s = slotAtIndex(i);
            const showLabel = s.getMinutes() === 0;
            return (
              <div
                key={i}
                className="border-b border-dashed text-right pr-2"
                style={{ height: slotPx, position: "relative" }}
              >
                {showLabel ? (
                  <span className="text-[10px] text-muted-foreground">
                    {formatHour(s.getHours(), 0)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Stylist columns */}
        {stylists.map((stylist) => {
          const appts = appointmentsByStylist.get(stylist.id) ?? [];
          return (
            <div
              key={stylist.id}
              className="border-r last:border-r-0"
              style={{ height: totalHeight, position: "relative" }}
            >
              {/* Background slot grid (clickable) */}
              {slotIndices.map((i) => {
                const slotStart = slotAtIndex(i);
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => onSlotClick?.(stylist.id, slotStart)}
                    className="block w-full border-b border-dashed hover:bg-accent/50 focus:bg-accent focus:outline-none"
                    style={{ height: slotPx }}
                    aria-label={`Book ${stylist.name} at ${formatHour(
                      slotStart.getHours(),
                      slotStart.getMinutes(),
                    )}`}
                  />
                );
              })}

              {/* Appointment blocks */}
              {appts.map((a) => {
                const start = new Date(a.startAt);
                const end = new Date(a.endAt);
                const top = slotOffsetPx(start);
                const heightPx = Math.max(
                  ((end.getTime() - start.getTime()) / 60000 / slotMinutes) *
                    slotPx -
                    2,
                  slotPx - 2,
                );
                const cls = STATUS_COLORS[a.status] ?? STATUS_COLORS.scheduled;
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => onAppointmentClick?.(a)}
                    className={`absolute left-1 right-1 rounded-md border-l-4 px-2 py-1 text-left text-xs shadow-sm hover:shadow-md ${cls}`}
                    style={{ top, height: heightPx }}
                  >
                    <div className="font-semibold truncate">{a.clientName}</div>
                    <div className="truncate text-[10px] opacity-80">
                      {a.serviceName} ·{" "}
                      {formatHour(start.getHours(), start.getMinutes())}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
