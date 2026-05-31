import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bosTicket } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no DB).
// ---------------------------------------------------------------------------

export interface SlaPolicyLike {
  firstResponseMins?: number | null;
  resolutionMins?: number | null;
}

/**
 * Compute the SLA resolution due-date for a ticket: createdAt plus the policy's
 * resolution window (in minutes). Falls back to a 1440-minute (24h) default
 * when the policy omits a resolution window.
 */
export function computeSlaDue(
  createdAt: Date | string,
  policy: SlaPolicyLike | null | undefined,
): Date {
  const base = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const mins =
    policy?.resolutionMins != null && policy.resolutionMins > 0
      ? policy.resolutionMins
      : 1440;
  return new Date(base.getTime() + mins * 60 * 1000);
}

export type TicketStatus = "open" | "pending" | "resolved" | "closed";

/**
 * Allowed status transitions for a helpdesk ticket. A ticket can move forward
 * through the workflow and reopen from resolved/closed back to open.
 */
export const ticketStatusFlow: Record<TicketStatus, TicketStatus[]> = {
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};

/** True when moving from `from` to `to` is a permitted ticket transition. */
export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  return (ticketStatusFlow[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// DB operations.
// ---------------------------------------------------------------------------

type TicketRow = typeof bosTicket.$inferSelect;

export interface AssignTicketParams {
  companyId: string;
  ticketId: string;
  assigneeUserId: string | null;
}

/** Assign (or unassign) a ticket to a user, scoped to the company. */
export async function assignTicket(
  db: Db,
  params: AssignTicketParams,
): Promise<TicketRow> {
  const { companyId, ticketId, assigneeUserId } = params;
  const [updated] = await db
    .update(bosTicket)
    .set({ assigneeUserId, updatedAt: new Date() })
    .where(and(eq(bosTicket.id, ticketId), eq(bosTicket.companyId, companyId)))
    .returning();
  if (!updated) {
    throw new Error("Ticket not found");
  }
  return updated;
}

export interface ResolveTicketParams {
  companyId: string;
  ticketId: string;
}

/**
 * Resolve a ticket: set status to "resolved" and stamp resolved_at. Runs in a
 * transaction so the load + state assertion + update are atomic.
 */
export async function resolveTicket(
  db: Db,
  params: ResolveTicketParams,
): Promise<TicketRow> {
  const { companyId, ticketId } = params;

  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(bosTicket)
      .where(eq(bosTicket.id, ticketId));
    if (!ticket || ticket.companyId !== companyId) {
      throw new Error("Ticket not found");
    }

    const current = (ticket.status ?? "open") as TicketStatus;
    if (!canTransitionTicket(current, "resolved")) {
      throw new Error(`Cannot resolve a ${current} ticket`);
    }

    const [updated] = await tx
      .update(bosTicket)
      .set({
        status: "resolved",
        resolvedAt: ticket.resolvedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bosTicket.id, ticket.id))
      .returning();
    if (!updated) {
      throw new Error("Failed to resolve ticket");
    }
    return updated;
  });
}
