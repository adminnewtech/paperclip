/**
 * Smart Cards service.
 *
 * Smart cards are interactive entity previews rendered inside the workspace
 * chat. They show a compact snapshot (e.g. customer name + amount + status
 * for an invoice) and expose action buttons whose handlers live here.
 *
 * The service is intentionally narrow:
 *   - `renderCard` / `renderCardBatch` load one or many rows from
 *     `business_entities` and project them to {@link SmartCard} shape.
 *   - `getAvailableActions` returns status-sensitive action lists.
 *   - `executeAction` dispatches to a per-action handler that mutates the
 *     underlying entity.
 *
 * All operations are company-scoped — the company id is always supplied by
 * the caller and propagated into every database query.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessEntities } from "@paperclipai/db";
import type {
  SmartCard,
  SmartCardAction,
  SmartCardType,
} from "@paperclipai/shared";
import {
  INVOICE_ACTIONS,
  ORDER_ACTIONS,
  TICKET_ACTIONS,
  EXPENSE_ACTIONS,
  PAYMENT_ACTIONS,
  DEAL_ACTIONS,
  CUSTOMER_ACTIONS,
  PRODUCT_ACTIONS,
  isValidActionKey,
} from "@paperclipai/shared";
import {
  buildSmartCard,
  getCardTypeDefinition,
  type EntityRow,
} from "./card-types.js";

export interface SmartCardActionContext {
  actorMemberId: string;
}

export interface SmartCardActionResult {
  success: boolean;
  message: string;
  messageAr: string;
  updatedCard?: SmartCard;
  resultEntityIds?: string[];
  errorCode?: string;
}

export interface SmartCardsService {
  renderCard(
    companyId: string,
    cardType: SmartCardType,
    entityId: string,
  ): Promise<SmartCard | null>;
  renderCardBatch(
    companyId: string,
    cardType: SmartCardType,
    entityIds: string[],
  ): Promise<SmartCard[]>;
  getAvailableActions(
    companyId: string,
    cardType: SmartCardType,
    entityId: string,
  ): Promise<SmartCardAction[]>;
  executeAction(
    companyId: string,
    cardType: SmartCardType,
    entityId: string,
    actionKey: string,
    ctx: SmartCardActionContext,
    args?: Record<string, unknown>,
  ): Promise<SmartCardActionResult>;
}

// ---------------------------------------------------------------------------
// Action handler registry
// ---------------------------------------------------------------------------

type ActionHandler = (
  companyId: string,
  row: EntityRow,
  ctx: SmartCardActionContext,
  db: Db,
  args: Record<string, unknown>,
) => Promise<SmartCardActionResult>;

/**
 * Update an entity row with a new status and/or data merge, scoped strictly
 * to the company. Returns the updated row.
 */
async function patchEntity(
  db: Db,
  companyId: string,
  row: EntityRow,
  update: {
    status?: string;
    dataMerge?: Record<string, unknown>;
    ownerUserId?: string | null;
  },
): Promise<EntityRow> {
  const existingData =
    row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {};
  const nextData = update.dataMerge
    ? { ...existingData, ...update.dataMerge }
    : existingData;
  const [updated] = await db
    .update(businessEntities)
    .set({
      status: update.status ?? row.status,
      ownerUserId:
        update.ownerUserId !== undefined ? update.ownerUserId : row.ownerUserId,
      data: nextData,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(businessEntities.id, row.id),
        eq(businessEntities.companyId, companyId),
      ),
    )
    .returning();
  return updated ?? row;
}

function ok(
  message: string,
  messageAr: string,
  updatedCard?: SmartCard,
  resultEntityIds?: string[],
): SmartCardActionResult {
  return { success: true, message, messageAr, updatedCard, resultEntityIds };
}

function fail(message: string, messageAr: string, errorCode = "action_failed"): SmartCardActionResult {
  return { success: false, message, messageAr, errorCode };
}

const HANDLERS: Record<SmartCardType, Record<string, ActionHandler>> = {
  invoice: {
    [INVOICE_ACTIONS.SEND_REMINDER]: async (companyId, row, _ctx, db) => {
      // Best-effort: stamp data.lastReminderAt — actual sending is delegated
      // to the messaging service via the dedicated /whatsapp send command.
      const updated = await patchEntity(db, companyId, row, {
        dataMerge: { lastReminderAt: new Date().toISOString() },
      }).catch(() => row);
      const card = buildSmartCard("invoice", updated) ?? undefined;
      return ok(
        "Reminder queued (use /whatsapp send to dispatch).",
        "تم وضع التذكير في قائمة الانتظار (استخدم /whatsapp send للإرسال).",
        card,
      );
    },
    [INVOICE_ACTIONS.MARK_PAID]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, {
        status: "paid",
        dataMerge: { paidAt: new Date().toISOString() },
      });
      const card = buildSmartCard("invoice", updated) ?? undefined;
      return ok("Invoice marked as paid.", "تم تعليم الفاتورة كمدفوعة.", card);
    },
    [INVOICE_ACTIONS.VIEW_PDF]: async (_companyId, row) => {
      return ok(
        `Open invoice PDF: /business/sales/invoice/${row.id}/pdf`,
        `افتح PDF الفاتورة: /business/sales/invoice/${row.id}/pdf`,
      );
    },
    [INVOICE_ACTIONS.CANCEL]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, { status: "cancelled" });
      const card = buildSmartCard("invoice", updated) ?? undefined;
      return ok("Invoice cancelled.", "تم إلغاء الفاتورة.", card);
    },
  },
  order: {
    [ORDER_ACTIONS.APPROVE]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, { status: "approved" });
      const card = buildSmartCard("order", updated) ?? undefined;
      return ok("Order approved.", "تمت الموافقة على الطلب.", card);
    },
    [ORDER_ACTIONS.SHIP]: async (companyId, row, _ctx, db, args) => {
      const tracking = typeof args.trackingNumber === "string" ? args.trackingNumber : null;
      const updated = await patchEntity(db, companyId, row, {
        status: "shipped",
        dataMerge: {
          shippedAt: new Date().toISOString(),
          ...(tracking ? { trackingNumber: tracking } : {}),
        },
      });
      const card = buildSmartCard("order", updated) ?? undefined;
      return ok("Order shipped.", "تم شحن الطلب.", card);
    },
    [ORDER_ACTIONS.CANCEL]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, { status: "cancelled" });
      const card = buildSmartCard("order", updated) ?? undefined;
      return ok("Order cancelled.", "تم إلغاء الطلب.", card);
    },
    [ORDER_ACTIONS.REFUND]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, {
        status: "refunded",
        dataMerge: { refundedAt: new Date().toISOString() },
      });
      const card = buildSmartCard("order", updated) ?? undefined;
      return ok("Order refunded.", "تم استرداد الطلب.", card);
    },
    [ORDER_ACTIONS.VIEW_TRACKING]: async (_companyId, row) => {
      const data =
        row.data && typeof row.data === "object" && !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)
          : {};
      const tracking = typeof data.trackingNumber === "string" ? data.trackingNumber : null;
      return ok(
        tracking ? `Tracking: ${tracking}` : "No tracking number on file.",
        tracking ? `رقم التتبع: ${tracking}` : "لا يوجد رقم تتبع.",
      );
    },
  },
  ticket: {
    [TICKET_ACTIONS.ASSIGN_TO_ME]: async (companyId, row, ctx, db) => {
      const updated = await patchEntity(db, companyId, row, {
        ownerUserId: ctx.actorMemberId,
      });
      const card = buildSmartCard("ticket", updated) ?? undefined;
      return ok("Ticket assigned to you.", "تم إسناد التذكرة إليك.", card);
    },
    [TICKET_ACTIONS.ASSIGN_TO]: async (companyId, row, _ctx, db, args) => {
      const assignee = typeof args.memberId === "string" ? args.memberId : null;
      if (!assignee) {
        return fail("memberId required.", "معرّف العضو مطلوب.", "missing_member");
      }
      const updated = await patchEntity(db, companyId, row, { ownerUserId: assignee });
      const card = buildSmartCard("ticket", updated) ?? undefined;
      return ok("Ticket reassigned.", "تم إعادة إسناد التذكرة.", card);
    },
    [TICKET_ACTIONS.CLOSE]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, { status: "closed" });
      const card = buildSmartCard("ticket", updated) ?? undefined;
      return ok("Ticket closed.", "تم إغلاق التذكرة.", card);
    },
    [TICKET_ACTIONS.ESCALATE]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, {
        dataMerge: { priority: "urgent", escalatedAt: new Date().toISOString() },
      });
      const card = buildSmartCard("ticket", updated) ?? undefined;
      return ok("Ticket escalated.", "تم تصعيد التذكرة.", card);
    },
    [TICKET_ACTIONS.REPLY]: async (_companyId, row) => {
      return ok(
        `Open reply dialog for ticket ${row.code ?? row.id}.`,
        `افتح نافذة الرد على التذكرة ${row.code ?? row.id}.`,
      );
    },
  },
  expense: {
    [EXPENSE_ACTIONS.CATEGORIZE]: async (companyId, row, _ctx, db, args) => {
      const category = typeof args.category === "string" ? args.category : null;
      if (!category) {
        return fail("category required.", "الفئة مطلوبة.", "missing_category");
      }
      const updated = await patchEntity(db, companyId, row, {
        dataMerge: { category },
      });
      const card = buildSmartCard("expense", updated) ?? undefined;
      return ok("Expense categorised.", "تم تصنيف المصروف.", card);
    },
    [EXPENSE_ACTIONS.MARK_REIMBURSABLE]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, {
        dataMerge: { reimbursable: true },
      });
      const card = buildSmartCard("expense", updated) ?? undefined;
      return ok("Marked reimbursable.", "تم التعليم كقابل للسداد.", card);
    },
    [EXPENSE_ACTIONS.DELETE]: async (companyId, row, _ctx, db) => {
      await db
        .delete(businessEntities)
        .where(
          and(
            eq(businessEntities.id, row.id),
            eq(businessEntities.companyId, companyId),
          ),
        );
      return ok("Expense deleted.", "تم حذف المصروف.");
    },
    [EXPENSE_ACTIONS.VIEW_RECEIPT]: async (_companyId, row) => {
      const data =
        row.data && typeof row.data === "object" && !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)
          : {};
      const url = typeof data.receiptUrl === "string" ? data.receiptUrl : null;
      return ok(
        url ?? "No receipt attached.",
        url ?? "لا يوجد إيصال مرفق.",
      );
    },
  },
  payment: {
    [PAYMENT_ACTIONS.LINK_TO_INVOICE]: async (companyId, row, _ctx, db, args) => {
      const invoiceId = typeof args.invoiceId === "string" ? args.invoiceId : null;
      if (!invoiceId) {
        return fail("invoiceId required.", "معرّف الفاتورة مطلوب.", "missing_invoice");
      }
      const updated = await patchEntity(db, companyId, row, {
        dataMerge: { invoiceId },
      });
      const card = buildSmartCard("payment", updated) ?? undefined;
      return ok("Payment linked.", "تم ربط الدفعة.", card);
    },
    [PAYMENT_ACTIONS.REFUND]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, { status: "refunded" });
      const card = buildSmartCard("payment", updated) ?? undefined;
      return ok("Payment refunded.", "تم استرداد الدفعة.", card);
    },
    [PAYMENT_ACTIONS.VIEW_RECEIPT]: async (_companyId, row) => {
      return ok(
        `Receipt: /business/sales/payment/${row.id}/receipt`,
        `الإيصال: /business/sales/payment/${row.id}/receipt`,
      );
    },
  },
  deal: {
    [DEAL_ACTIONS.ADVANCE_STAGE]: async (companyId, row, _ctx, db) => {
      const stages = ["prospecting", "qualified", "proposal", "negotiation", "won"];
      const current = row.status?.toLowerCase() ?? "prospecting";
      const idx = stages.indexOf(current);
      const next = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1]! : current;
      const updated = await patchEntity(db, companyId, row, { status: next });
      const card = buildSmartCard("deal", updated) ?? undefined;
      return ok(`Deal moved to ${next}.`, `تم نقل الصفقة إلى ${next}.`, card);
    },
    [DEAL_ACTIONS.MARK_WON]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, {
        status: "won",
        dataMerge: { wonAt: new Date().toISOString() },
      });
      const card = buildSmartCard("deal", updated) ?? undefined;
      return ok("Deal marked as won.", "تم تعليم الصفقة كرابحة.", card);
    },
    [DEAL_ACTIONS.MARK_LOST]: async (companyId, row, _ctx, db) => {
      const updated = await patchEntity(db, companyId, row, {
        status: "lost",
        dataMerge: { lostAt: new Date().toISOString() },
      });
      const card = buildSmartCard("deal", updated) ?? undefined;
      return ok("Deal marked as lost.", "تم تعليم الصفقة كخاسرة.", card);
    },
    [DEAL_ACTIONS.ASSIGN_TO]: async (companyId, row, _ctx, db, args) => {
      const assignee = typeof args.memberId === "string" ? args.memberId : null;
      if (!assignee) {
        return fail("memberId required.", "معرّف العضو مطلوب.", "missing_member");
      }
      const updated = await patchEntity(db, companyId, row, { ownerUserId: assignee });
      const card = buildSmartCard("deal", updated) ?? undefined;
      return ok("Deal reassigned.", "تم إعادة إسناد الصفقة.", card);
    },
  },
  customer: {
    [CUSTOMER_ACTIONS.VIEW_ORDERS]: async (_companyId, row) => {
      return ok(
        `Open orders for ${row.name ?? row.id}.`,
        `افتح طلبات ${row.name ?? row.id}.`,
      );
    },
    [CUSTOMER_ACTIONS.SEND_EMAIL]: async (_companyId, row) => {
      return ok(
        `Compose email to ${row.name ?? row.id}.`,
        `أنشئ بريداً إلى ${row.name ?? row.id}.`,
      );
    },
    [CUSTOMER_ACTIONS.SEND_WHATSAPP]: async (_companyId, row) => {
      return ok(
        `Use /whatsapp send @${row.name ?? row.id} <message>`,
        `استخدم /whatsapp send @${row.name ?? row.id} <رسالة>`,
      );
    },
    [CUSTOMER_ACTIONS.ADD_NOTE]: async (companyId, row, _ctx, db, args) => {
      const note = typeof args.note === "string" ? args.note : null;
      if (!note) {
        return fail("note required.", "الملاحظة مطلوبة.", "missing_note");
      }
      const existingData =
        row.data && typeof row.data === "object" && !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)
          : {};
      const existingNotes = Array.isArray(existingData.notes)
        ? (existingData.notes as unknown[])
        : [];
      const updated = await patchEntity(db, companyId, row, {
        dataMerge: {
          notes: [...existingNotes, { text: note, at: new Date().toISOString() }],
        },
      });
      const card = buildSmartCard("customer", updated) ?? undefined;
      return ok("Note added.", "تمت إضافة الملاحظة.", card);
    },
  },
  product: {
    [PRODUCT_ACTIONS.UPDATE_PRICE]: async (companyId, row, _ctx, db, args) => {
      const priceCents = typeof args.priceCents === "number" ? args.priceCents : null;
      if (priceCents === null) {
        return fail("priceCents required.", "السعر مطلوب.", "missing_price");
      }
      const updated = await patchEntity(db, companyId, row, {
        dataMerge: { priceCents },
      });
      // Also update top-level amount_cents for quick filtering.
      await db
        .update(businessEntities)
        .set({ amountCents: priceCents, updatedAt: new Date() })
        .where(and(eq(businessEntities.id, row.id), eq(businessEntities.companyId, companyId)));
      const card = buildSmartCard("product", updated) ?? undefined;
      return ok("Price updated.", "تم تحديث السعر.", card);
    },
    [PRODUCT_ACTIONS.UPDATE_STOCK]: async (companyId, row, _ctx, db, args) => {
      const stock = typeof args.stock === "number" ? args.stock : null;
      if (stock === null) {
        return fail("stock required.", "المخزون مطلوب.", "missing_stock");
      }
      const updated = await patchEntity(db, companyId, row, {
        dataMerge: { stock },
      });
      const card = buildSmartCard("product", updated) ?? undefined;
      return ok("Stock updated.", "تم تحديث المخزون.", card);
    },
    [PRODUCT_ACTIONS.VIEW_SALES]: async (_companyId, row) => {
      return ok(
        `Open sales report for ${row.name ?? row.id}.`,
        `افتح تقرير مبيعات ${row.name ?? row.id}.`,
      );
    },
    [PRODUCT_ACTIONS.TOGGLE_ACTIVE]: async (companyId, row, _ctx, db) => {
      const isActive = row.status?.toLowerCase() === "active";
      const next = isActive ? "inactive" : "active";
      const updated = await patchEntity(db, companyId, row, { status: next });
      const card = buildSmartCard("product", updated) ?? undefined;
      return ok(
        isActive ? "Product deactivated." : "Product activated.",
        isActive ? "تم تعطيل المنتج." : "تم تنشيط المنتج.",
        card,
      );
    },
  },
};

/**
 * Public table of action handlers — kept as an object of objects so it is
 * easy to extend (e.g. by plugins) at runtime if needed.
 */
export const CARD_ACTION_HANDLERS = HANDLERS;

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createSmartCardsService(db: Db): SmartCardsService {
  async function loadRow(
    companyId: string,
    cardType: SmartCardType,
    entityId: string,
  ): Promise<EntityRow | null> {
    const def = getCardTypeDefinition(cardType);
    if (!def) return null;
    const [row] = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.id, entityId),
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, def.moduleKey),
          eq(businessEntities.entityType, def.entityType),
        ),
      );
    return row ?? null;
  }

  async function renderCard(
    companyId: string,
    cardType: SmartCardType,
    entityId: string,
  ): Promise<SmartCard | null> {
    const row = await loadRow(companyId, cardType, entityId);
    if (!row) return null;
    return buildSmartCard(cardType, row);
  }

  async function renderCardBatch(
    companyId: string,
    cardType: SmartCardType,
    entityIds: string[],
  ): Promise<SmartCard[]> {
    if (entityIds.length === 0) return [];
    const def = getCardTypeDefinition(cardType);
    if (!def) return [];
    const rows = await db
      .select()
      .from(businessEntities)
      .where(
        and(
          eq(businessEntities.companyId, companyId),
          eq(businessEntities.moduleKey, def.moduleKey),
          eq(businessEntities.entityType, def.entityType),
          inArray(businessEntities.id, entityIds),
        ),
      );
    const cards: SmartCard[] = [];
    for (const row of rows) {
      const card = buildSmartCard(cardType, row);
      if (card) cards.push(card);
    }
    return cards;
  }

  async function getAvailableActions(
    companyId: string,
    cardType: SmartCardType,
    entityId: string,
  ): Promise<SmartCardAction[]> {
    const row = await loadRow(companyId, cardType, entityId);
    if (!row) return [];
    const def = getCardTypeDefinition(cardType);
    return def ? def.getActions(row) : [];
  }

  async function executeAction(
    companyId: string,
    cardType: SmartCardType,
    entityId: string,
    actionKey: string,
    ctx: SmartCardActionContext,
    args: Record<string, unknown> = {},
  ): Promise<SmartCardActionResult> {
    if (!isValidActionKey(cardType, actionKey)) {
      return fail("Unknown action.", "إجراء غير معروف.", "unknown_action");
    }
    const row = await loadRow(companyId, cardType, entityId);
    if (!row) {
      return fail("Entity not found.", "الكيان غير موجود.", "not_found");
    }
    const handler = HANDLERS[cardType]?.[actionKey];
    if (!handler) {
      return fail("Action handler unavailable.", "معالج الإجراء غير متاح.", "no_handler");
    }
    try {
      return await handler(companyId, row, ctx, db, args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Action failed: ${msg}`, `فشل الإجراء: ${msg}`, "exception");
    }
  }

  return {
    renderCard,
    renderCardBatch,
    getAvailableActions,
    executeAction,
  };
}
