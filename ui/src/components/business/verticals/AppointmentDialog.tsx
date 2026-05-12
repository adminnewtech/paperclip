import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ServicePicker } from "./ServicePicker";
import type {
  Appointment,
  ConflictDetails,
  CreateAppointmentInput,
  SalonServiceEntity,
  Stylist,
} from "../../../api/business-salons";

interface AppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stylists: Stylist[];
  services: SalonServiceEntity[];
  initialStylistId?: string;
  initialStartAt?: Date;
  appointment?: Appointment | null;
  onSubmit: (input: CreateAppointmentInput) => Promise<void>;
  onCancel?: (id: string, reason?: string) => Promise<void>;
  onComplete?: (id: string) => Promise<void>;
  onNoShow?: (id: string) => Promise<void>;
  onSendReminder?: (id: string) => Promise<void>;
}

function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AppointmentDialog({
  open,
  onOpenChange,
  stylists,
  services,
  initialStylistId,
  initialStartAt,
  appointment,
  onSubmit,
  onCancel,
  onComplete,
  onNoShow,
  onSendReminder,
}: AppointmentDialogProps) {
  const isEdit = Boolean(appointment);
  const [stylistId, setStylistId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [clientPhone, setClientPhone] = useState<string>("");
  const [startAt, setStartAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [sendReminder, setSendReminder] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictDetails | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConflict(null);
    if (appointment) {
      setStylistId(appointment.stylistId);
      setServiceId(appointment.serviceId);
      setClientName(appointment.clientName);
      setClientPhone(appointment.clientPhone ?? "");
      setStartAt(toLocalDatetimeInput(new Date(appointment.startAt)));
      setNotes(appointment.notes ?? "");
      setSendReminder(appointment.sendReminderHoursBefore > 0);
    } else {
      setStylistId(initialStylistId ?? stylists[0]?.id ?? "");
      setServiceId(services[0]?.id ?? "");
      setClientName("");
      setClientPhone("");
      setStartAt(
        initialStartAt
          ? toLocalDatetimeInput(initialStartAt)
          : toLocalDatetimeInput(new Date()),
      );
      setNotes("");
      setSendReminder(true);
    }
  }, [
    open,
    appointment,
    initialStylistId,
    initialStartAt,
    stylists,
    services,
  ]);

  async function handleSubmit() {
    setError(null);
    setConflict(null);
    if (!stylistId || !serviceId || !startAt) {
      setError("Stylist, service, and start time are required.");
      return;
    }
    if (!clientName.trim() && !appointment) {
      setError("Client name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const iso = new Date(startAt).toISOString();
      await onSubmit({
        stylistId,
        serviceId,
        startAt: iso,
        clientName: clientName.trim() || undefined,
        clientPhone: clientPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        sendReminderHoursBefore: sendReminder ? 24 : 0,
      });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as
          | { error?: string; details?: ConflictDetails }
          | null;
        setConflict(body?.details ?? null);
        setError(body?.error ?? "Time slot unavailable");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit appointment" : "New appointment"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="apt-client">Client name</Label>
            <Input
              id="apt-client"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Noura Al-Saleh"
              disabled={submitting}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="apt-phone">Client phone (for reminders)</Label>
            <Input
              id="apt-phone"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="+96599XXXXXX"
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Stylist</Label>
              <Select
                value={stylistId}
                onValueChange={setStylistId}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a stylist" />
                </SelectTrigger>
                <SelectContent>
                  {stylists.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Service</Label>
              <ServicePicker
                services={services}
                value={serviceId}
                onChange={setServiceId}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="apt-start">Start time</Label>
            <Input
              id="apt-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="apt-notes">Notes</Label>
            <Textarea
              id="apt-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              disabled={submitting}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sendReminder}
              onChange={(e) => setSendReminder(e.target.checked)}
              disabled={submitting}
            />
            Send reminder 24h before
          </label>

          {error ? (
            <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-200">
              {error}
              {conflict?.suggestedAlternatives &&
              conflict.suggestedAlternatives.length > 0 ? (
                <div className="mt-2">
                  <div className="text-xs font-semibold">
                    Try a different time:
                  </div>
                  <ul className="mt-1 space-y-1">
                    {conflict.suggestedAlternatives.map((alt) => (
                      <li key={alt.startAt}>
                        <button
                          type="button"
                          className="rounded bg-white/70 px-2 py-1 text-xs hover:bg-white dark:bg-rose-950/40 dark:hover:bg-rose-950"
                          onClick={() =>
                            setStartAt(toLocalDatetimeInput(new Date(alt.startAt)))
                          }
                        >
                          {new Date(alt.startAt).toLocaleString()} — {alt.reason}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
          {isEdit && appointment ? (
            <div className="flex flex-wrap items-center gap-2">
              {onComplete ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onComplete(appointment.id)}
                >
                  Mark completed
                </Button>
              ) : null}
              {onNoShow ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onNoShow(appointment.id)}
                >
                  No-show
                </Button>
              ) : null}
              {onCancel ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onCancel(appointment.id)}
                >
                  Cancel
                </Button>
              ) : null}
              {onSendReminder ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onSendReminder(appointment.id)}
                >
                  Send reminder
                </Button>
              ) : null}
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Close
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {isEdit ? "Save changes" : "Book appointment"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
