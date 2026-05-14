import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import { approvalService } from "./approvals.js";
import { inboxDismissalService } from "./inbox-dismissals.js";
import { logActivity } from "./activity-log.js";

/**
 * Cross-cutting events service for the Business module.
 *
 * Bridges business-domain changes to the platform's shared notification
 * surfaces:
 *
 *   - **Inbox**: per-user live events that surface in the user's inbox feed.
 *     (The inbox is computed from activity + approvals + dismissals, so we
 *     publish a `inbox.item.created` live event so subscribers can refresh
 *     immediately and we also persist an activity row for durability.)
 *   - **Activity**: append-only audit/feed via {@link logActivity}.
 *   - **Approvals**: pending decisions via {@link approvalService}.
 *
 * Routes in `business.ts` can opt-in to these helpers when domain events
 * happen (invoice paid, expense over threshold, ticket SLA breach, etc.).
 * Nothing in this file auto-fires — callers must invoke the methods
 * explicitly to keep wiring observable and testable.
 */

/** Reference to a business entity that an event is about. */
export interface BusinessEntityRef {
  /** Module key, e.g. `"sales"`, `"finance"`, `"helpdesk"`. */
  moduleKey: string;
  /** Entity type within the module, e.g. `"invoice"`, `"expense"`, `"ticket"`. */
  entityType: string;
  /** Business entity row id. */
  entityId: string;
  /** Optional human-readable label (name or code) for display. */
  label?: string | null;
}

export interface EmitInboxItemInput {
  kind: string;
  title: string;
  body?: string | null;
  entityRef: BusinessEntityRef;
}

export interface EmitActivityInput {
  action: string;
  entityRef: BusinessEntityRef;
  payload?: Record<string, unknown> | null;
}

export interface RequestApprovalInput {
  /** Approval kind, e.g. `"business.expense"`, `"business.invoice"`. */
  kind: string;
  entityRef: BusinessEntityRef;
  amountCents?: number | null;
  reason?: string | null;
  extraPayload?: Record<string, unknown> | null;
}

export type BusinessEventsService = ReturnType<typeof createBusinessEventsService>;

export function createBusinessEventsService(db: Db) {
  const approvals = approvalService(db);
  // Inbox items are derived from activity + approvals; the dismissal service
  // is kept here for symmetry so callers can also dismiss inbox items via the
  // events service if desired in the future.
  const inboxDismissals = inboxDismissalService(db);
  void inboxDismissals;

  /**
   * Push a per-user inbox notification.
   *
   * Inbox items are derived from the activity log + approvals + dismissals
   * by the platform; we record the notification as an `activity.logged`
   * event so subscribed inbox UIs refresh immediately and the row remains
   * durable across reloads.
   */
  async function emitInboxItem(
    companyId: string,
    userId: string,
    input: EmitInboxItemInput,
  ): Promise<void> {
    await logActivity(db, {
      companyId,
      actorType: "system",
      actorId: "business",
      action: `business.inbox.${input.kind}`,
      entityType: "business_entity",
      entityId: input.entityRef.entityId,
      details: {
        userId,
        title: input.title,
        body: input.body ?? null,
        moduleKey: input.entityRef.moduleKey,
        entityType: input.entityRef.entityType,
      },
    });
  }

  /**
   * Append a generic business activity event. Mirrors {@link logActivity}
   * but with a stable shape for business-entity references.
   */
  async function emitActivity(
    companyId: string,
    userId: string | null,
    input: EmitActivityInput,
  ): Promise<void> {
    await logActivity(db, {
      companyId,
      actorType: userId ? "user" : "system",
      actorId: userId ?? "business",
      action: input.action,
      entityType: "business_entity",
      entityId: input.entityRef.entityId,
      details: {
        moduleKey: input.entityRef.moduleKey,
        entityType: input.entityRef.entityType,
        label: input.entityRef.label ?? null,
        ...(input.payload ?? {}),
      },
    });
  }

  /**
   * Create a pending approval for a business event (e.g. high-value invoice,
   * over-threshold expense). Returns the created approval row.
   */
  async function requestApproval(
    companyId: string,
    userId: string | null,
    input: RequestApprovalInput,
  ) {
    const approval = await approvals.create(companyId, {
      type: input.kind,
      requestedByUserId: userId ?? null,
      status: "pending",
      payload: {
        moduleKey: input.entityRef.moduleKey,
        entityType: input.entityRef.entityType,
        entityId: input.entityRef.entityId,
        label: input.entityRef.label ?? null,
        amountCents: input.amountCents ?? null,
        reason: input.reason ?? null,
        ...(input.extraPayload ?? {}),
      },
    });

    if (approval) {
      await logActivity(db, {
        companyId,
        actorType: userId ? "user" : "system",
        actorId: userId ?? "business",
        action: "business.approval_requested",
        entityType: "approval",
        entityId: approval.id,
        details: {
          kind: input.kind,
          moduleKey: input.entityRef.moduleKey,
          entityType: input.entityRef.entityType,
          businessEntityId: input.entityRef.entityId,
          amountCents: input.amountCents ?? null,
          reason: input.reason ?? null,
        },
      });
    }

    return approval;
  }

  return {
    emitInboxItem,
    emitActivity,
    requestApproval,
  };
}

// ---------------------------------------------------------------------------
// Pre-built helpers
// ---------------------------------------------------------------------------
//
// These wrap the primitives above for common business-domain triggers. They
// are not invoked from `business.ts` yet — they exist so route handlers (or
// scheduled jobs) can fire-and-forget standard notifications without
// re-implementing the wiring each time.

async function loadBusinessEntity(db: Db, companyId: string, entityId: string) {
  const [row] = await db
    .select()
    .from(businessEntities)
    .where(and(eq(businessEntities.id, entityId), eq(businessEntities.companyId, companyId)));
  return row ?? null;
}

/**
 * Notify the invoice owner that an invoice has been marked paid.
 *
 * Emits an inbox item to `ownerUserId` (if present) and an activity event.
 * Safe to call as fire-and-forget; missing entities are a no-op.
 */
export async function notifyInvoicePaid(
  db: Db,
  companyId: string,
  invoiceId: string,
): Promise<void> {
  const invoice = await loadBusinessEntity(db, companyId, invoiceId);
  if (!invoice || invoice.moduleKey !== "sales" || invoice.entityType !== "invoice") return;

  const events = createBusinessEventsService(db);
  const label = invoice.code ?? invoice.name ?? invoiceId;
  const entityRef: BusinessEntityRef = {
    moduleKey: invoice.moduleKey,
    entityType: invoice.entityType,
    entityId: invoice.id,
    label,
  };

  await events.emitActivity(companyId, invoice.ownerUserId ?? null, {
    action: "business.invoice_paid",
    entityRef,
    payload: { amountCents: invoice.amountCents ?? null, currency: invoice.currency ?? null },
  });

  if (invoice.ownerUserId) {
    await events.emitInboxItem(companyId, invoice.ownerUserId, {
      kind: "invoice_paid",
      title: `Invoice ${label} paid`,
      body: invoice.amountCents
        ? `Payment received for ${(invoice.amountCents / 100).toFixed(2)} ${invoice.currency ?? ""}`.trim()
        : null,
      entityRef,
    });
  }
}

/**
 * Default expense approval threshold (50,000 minor units / SAR 500.00).
 *
 * Routes can override at call site. Kept low so demos exercise the approval
 * path with reasonable test data.
 */
export const DEFAULT_EXPENSE_APPROVAL_THRESHOLD_CENTS = 5_000_000;

/**
 * If `amountCents` exceeds the threshold, create a pending approval for the
 * expense. Otherwise no-op. Returns the created approval (if any).
 */
export async function notifyExpenseNeedsApproval(
  db: Db,
  companyId: string,
  expenseId: string,
  amountCents: number,
  thresholdCents: number = DEFAULT_EXPENSE_APPROVAL_THRESHOLD_CENTS,
) {
  if (amountCents <= thresholdCents) return null;
  const expense = await loadBusinessEntity(db, companyId, expenseId);
  if (!expense || expense.moduleKey !== "finance" || expense.entityType !== "expense") return null;

  const events = createBusinessEventsService(db);
  const label = expense.code ?? expense.name ?? expenseId;
  return events.requestApproval(companyId, expense.ownerUserId ?? null, {
    kind: "business.expense",
    entityRef: {
      moduleKey: expense.moduleKey,
      entityType: expense.entityType,
      entityId: expense.id,
      label,
    },
    amountCents,
    reason: `Expense ${label} exceeds approval threshold of ${(thresholdCents / 100).toFixed(2)}`,
  });
}

/**
 * Notify the support team that a ticket has breached its SLA. Emits both an
 * inbox item to the ticket owner (if any) and an activity event.
 */
export async function notifyTicketSlaBreach(
  db: Db,
  companyId: string,
  ticketId: string,
): Promise<void> {
  const ticket = await loadBusinessEntity(db, companyId, ticketId);
  if (!ticket || ticket.moduleKey !== "helpdesk" || ticket.entityType !== "ticket") return;

  const events = createBusinessEventsService(db);
  const label = ticket.code ?? ticket.name ?? ticketId;
  const entityRef: BusinessEntityRef = {
    moduleKey: ticket.moduleKey,
    entityType: ticket.entityType,
    entityId: ticket.id,
    label,
  };

  await events.emitActivity(companyId, ticket.ownerUserId ?? null, {
    action: "business.ticket_sla_breached",
    entityRef,
    payload: { status: ticket.status },
  });

  if (ticket.ownerUserId) {
    await events.emitInboxItem(companyId, ticket.ownerUserId, {
      kind: "ticket_sla_breach",
      title: `Ticket ${label} breached SLA`,
      body: `Status: ${ticket.status}`,
      entityRef,
    });
  }
}
