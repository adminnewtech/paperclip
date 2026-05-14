/**
 * Definitions for the 8 smart-card types rendered inside the workspace chat.
 *
 * Each card type has:
 *   - A description of the snapshot fields it surfaces in chat
 *   - A `moduleKey` + `entityType` pointing at the underlying business entity
 *   - A `buildSnapshot` function that maps a business_entities row into the
 *     compact card payload sent to the client
 *   - A `getActions` function that returns the action buttons available for
 *     the current status (e.g. "Mark Paid" doesn't show for already-paid
 *     invoices).
 *
 * Action *handlers* (the actual side-effects when a button is clicked) live
 * in `./index.ts` so this file stays pure data.
 */
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
} from "@paperclipai/shared";
import type { businessEntities } from "@paperclipai/db";

export type EntityRow = typeof businessEntities.$inferSelect;

export interface CardTypeDefinition {
  cardType: SmartCardType;
  moduleKey: string;
  entityType: string;
  buildSnapshot(row: EntityRow): Record<string, unknown>;
  getActions(row: EntityRow): SmartCardAction[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function pickNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

const INVOICE_CARD: CardTypeDefinition = {
  cardType: "invoice",
  moduleKey: "sales",
  entityType: "invoice",
  buildSnapshot(row) {
    const data = asRecord(row.data);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      customerName: pickString(data, "customerName") ?? row.name,
      customerId: pickString(data, "customerId"),
      amountCents: row.amountCents ?? null,
      currency: row.currency,
      status: row.status,
      dueDate: pickString(data, "dueDate"),
      issuedAt: pickString(data, "issuedAt"),
    };
  },
  getActions(row) {
    const status = row.status?.toLowerCase() ?? "";
    const actions: SmartCardAction[] = [];
    if (status !== "paid" && status !== "cancelled") {
      actions.push({
        key: INVOICE_ACTIONS.SEND_REMINDER,
        label: "Send Reminder",
        labelAr: "إرسال تذكير",
        style: "primary",
      });
      actions.push({
        key: INVOICE_ACTIONS.MARK_PAID,
        label: "Mark Paid",
        labelAr: "تعليم كمدفوعة",
        style: "primary",
        requiresConfirmation: true,
      });
    }
    actions.push({
      key: INVOICE_ACTIONS.VIEW_PDF,
      label: "View PDF",
      labelAr: "عرض PDF",
      style: "secondary",
    });
    if (status !== "cancelled" && status !== "paid") {
      actions.push({
        key: INVOICE_ACTIONS.CANCEL,
        label: "Cancel",
        labelAr: "إلغاء",
        style: "destructive",
        requiresConfirmation: true,
      });
    }
    return actions;
  },
};

const ORDER_CARD: CardTypeDefinition = {
  cardType: "order",
  moduleKey: "ecommerce",
  entityType: "online_order",
  buildSnapshot(row) {
    const data = asRecord(row.data);
    const items = Array.isArray(data.items) ? data.items : [];
    return {
      id: row.id,
      code: row.code,
      customerName: pickString(data, "customerName") ?? row.name,
      itemsCount: items.length,
      totalCents: row.amountCents ?? null,
      currency: row.currency,
      status: row.status,
      tracking: pickString(data, "trackingNumber"),
    };
  },
  getActions(row) {
    const status = row.status?.toLowerCase() ?? "";
    const actions: SmartCardAction[] = [];
    if (status === "pending" || status === "awaiting_approval") {
      actions.push({
        key: ORDER_ACTIONS.APPROVE,
        label: "Approve",
        labelAr: "موافقة",
        style: "primary",
      });
    }
    if (status === "paid" || status === "approved") {
      actions.push({
        key: ORDER_ACTIONS.SHIP,
        label: "Ship",
        labelAr: "شحن",
        style: "primary",
      });
    }
    if (status !== "cancelled" && status !== "shipped") {
      actions.push({
        key: ORDER_ACTIONS.CANCEL,
        label: "Cancel",
        labelAr: "إلغاء",
        style: "destructive",
        requiresConfirmation: true,
      });
    }
    if (status === "paid" || status === "shipped") {
      actions.push({
        key: ORDER_ACTIONS.REFUND,
        label: "Refund",
        labelAr: "استرداد",
        style: "destructive",
        requiresConfirmation: true,
      });
    }
    if (status === "shipped") {
      actions.push({
        key: ORDER_ACTIONS.VIEW_TRACKING,
        label: "View Tracking",
        labelAr: "تتبع الشحنة",
        style: "secondary",
      });
    }
    return actions;
  },
};

const TICKET_CARD: CardTypeDefinition = {
  cardType: "ticket",
  moduleKey: "helpdesk",
  entityType: "ticket",
  buildSnapshot(row) {
    const data = asRecord(row.data);
    return {
      id: row.id,
      code: row.code,
      subject: row.name,
      customerName: pickString(data, "customerName"),
      priority: pickString(data, "priority") ?? "normal",
      status: row.status,
      assigneeId: row.ownerUserId,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
    };
  },
  getActions(row) {
    const status = row.status?.toLowerCase() ?? "";
    const actions: SmartCardAction[] = [
      {
        key: TICKET_ACTIONS.ASSIGN_TO_ME,
        label: "Assign to Me",
        labelAr: "إسناد إليّ",
        style: "primary",
      },
      {
        key: TICKET_ACTIONS.ASSIGN_TO,
        label: "Assign…",
        labelAr: "إسناد…",
        style: "secondary",
      },
      {
        key: TICKET_ACTIONS.REPLY,
        label: "Reply",
        labelAr: "رد",
        style: "secondary",
      },
    ];
    if (status !== "closed" && status !== "resolved") {
      actions.push({
        key: TICKET_ACTIONS.CLOSE,
        label: "Close",
        labelAr: "إغلاق",
        style: "secondary",
      });
      actions.push({
        key: TICKET_ACTIONS.ESCALATE,
        label: "Escalate",
        labelAr: "تصعيد",
        style: "destructive",
      });
    }
    return actions;
  },
};

const EXPENSE_CARD: CardTypeDefinition = {
  cardType: "expense",
  moduleKey: "finance",
  entityType: "expense",
  buildSnapshot(row) {
    const data = asRecord(row.data);
    return {
      id: row.id,
      code: row.code,
      category: pickString(data, "category") ?? row.name,
      vendor: pickString(data, "vendor"),
      amountCents: row.amountCents ?? null,
      currency: row.currency,
      description: pickString(data, "description"),
      date: pickString(data, "date") ?? (row.createdAt instanceof Date ? row.createdAt.toISOString() : null),
      receiptUrl: pickString(data, "receiptUrl"),
    };
  },
  getActions(_row) {
    return [
      {
        key: EXPENSE_ACTIONS.CATEGORIZE,
        label: "Categorize",
        labelAr: "تصنيف",
        style: "primary",
      },
      {
        key: EXPENSE_ACTIONS.MARK_REIMBURSABLE,
        label: "Reimbursable",
        labelAr: "قابل للسداد",
        style: "secondary",
      },
      {
        key: EXPENSE_ACTIONS.VIEW_RECEIPT,
        label: "View Receipt",
        labelAr: "عرض الإيصال",
        style: "secondary",
      },
      {
        key: EXPENSE_ACTIONS.DELETE,
        label: "Delete",
        labelAr: "حذف",
        style: "destructive",
        requiresConfirmation: true,
      },
    ];
  },
};

const PAYMENT_CARD: CardTypeDefinition = {
  cardType: "payment",
  moduleKey: "sales",
  entityType: "payment",
  buildSnapshot(row) {
    const data = asRecord(row.data);
    return {
      id: row.id,
      code: row.code,
      amountCents: row.amountCents ?? null,
      currency: row.currency,
      method: pickString(data, "method"),
      customerName: pickString(data, "customerName"),
      status: row.status,
      invoiceCode: pickString(data, "invoiceCode"),
      invoiceId: pickString(data, "invoiceId"),
    };
  },
  getActions(_row) {
    return [
      {
        key: PAYMENT_ACTIONS.LINK_TO_INVOICE,
        label: "Link to Invoice",
        labelAr: "ربط بفاتورة",
        style: "primary",
      },
      {
        key: PAYMENT_ACTIONS.VIEW_RECEIPT,
        label: "View Receipt",
        labelAr: "عرض الإيصال",
        style: "secondary",
      },
      {
        key: PAYMENT_ACTIONS.REFUND,
        label: "Refund",
        labelAr: "استرداد",
        style: "destructive",
        requiresConfirmation: true,
      },
    ];
  },
};

const DEAL_CARD: CardTypeDefinition = {
  cardType: "deal",
  moduleKey: "crm",
  entityType: "deal",
  buildSnapshot(row) {
    const data = asRecord(row.data);
    return {
      id: row.id,
      code: row.code,
      title: row.name,
      customerName: pickString(data, "customerName") ?? row.name,
      amountCents: row.amountCents ?? null,
      currency: row.currency,
      stage: row.status,
      probability: pickNumber(data, "probability"),
      expectedClose: pickString(data, "expectedClose"),
      ownerId: row.ownerUserId,
    };
  },
  getActions(row) {
    const stage = row.status?.toLowerCase() ?? "";
    const actions: SmartCardAction[] = [];
    if (stage !== "won" && stage !== "lost") {
      actions.push({
        key: DEAL_ACTIONS.ADVANCE_STAGE,
        label: "Advance Stage",
        labelAr: "نقل للمرحلة التالية",
        style: "primary",
      });
      actions.push({
        key: DEAL_ACTIONS.MARK_WON,
        label: "Mark Won",
        labelAr: "تعليم كرابح",
        style: "primary",
        requiresConfirmation: true,
      });
      actions.push({
        key: DEAL_ACTIONS.MARK_LOST,
        label: "Mark Lost",
        labelAr: "تعليم كخاسر",
        style: "destructive",
        requiresConfirmation: true,
      });
    }
    actions.push({
      key: DEAL_ACTIONS.ASSIGN_TO,
      label: "Assign…",
      labelAr: "إسناد…",
      style: "secondary",
    });
    return actions;
  },
};

const CUSTOMER_CARD: CardTypeDefinition = {
  cardType: "customer",
  moduleKey: "crm",
  entityType: "contact",
  buildSnapshot(row) {
    const data = asRecord(row.data);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      email: pickString(data, "email"),
      phone: pickString(data, "phone"),
      totalRevenueCents: pickNumber(data, "totalRevenueCents"),
      lifetimeValueCents: pickNumber(data, "lifetimeValueCents"),
      lastOrderAt: pickString(data, "lastOrderAt"),
      currency: row.currency,
    };
  },
  getActions(_row) {
    return [
      {
        key: CUSTOMER_ACTIONS.VIEW_ORDERS,
        label: "View Orders",
        labelAr: "عرض الطلبات",
        style: "primary",
      },
      {
        key: CUSTOMER_ACTIONS.SEND_EMAIL,
        label: "Send Email",
        labelAr: "إرسال بريد",
        style: "secondary",
      },
      {
        key: CUSTOMER_ACTIONS.SEND_WHATSAPP,
        label: "WhatsApp",
        labelAr: "واتساب",
        style: "secondary",
      },
      {
        key: CUSTOMER_ACTIONS.ADD_NOTE,
        label: "Add Note",
        labelAr: "إضافة ملاحظة",
        style: "secondary",
      },
    ];
  },
};

const PRODUCT_CARD: CardTypeDefinition = {
  cardType: "product",
  moduleKey: "inventory",
  entityType: "product",
  buildSnapshot(row) {
    const data = asRecord(row.data);
    return {
      id: row.id,
      sku: row.code,
      name: row.name,
      priceCents: pickNumber(data, "priceCents") ?? row.amountCents ?? null,
      currency: row.currency,
      stock: pickNumber(data, "stock"),
      category: pickString(data, "category"),
      active: row.status?.toLowerCase() === "active",
      status: row.status,
    };
  },
  getActions(row) {
    const isActive = row.status?.toLowerCase() === "active";
    return [
      {
        key: PRODUCT_ACTIONS.UPDATE_PRICE,
        label: "Update Price",
        labelAr: "تحديث السعر",
        style: "primary",
      },
      {
        key: PRODUCT_ACTIONS.UPDATE_STOCK,
        label: "Update Stock",
        labelAr: "تحديث المخزون",
        style: "primary",
      },
      {
        key: PRODUCT_ACTIONS.VIEW_SALES,
        label: "View Sales",
        labelAr: "عرض المبيعات",
        style: "secondary",
      },
      {
        key: PRODUCT_ACTIONS.TOGGLE_ACTIVE,
        label: isActive ? "Deactivate" : "Activate",
        labelAr: isActive ? "تعطيل" : "تنشيط",
        style: isActive ? "destructive" : "primary",
        requiresConfirmation: isActive,
      },
    ];
  },
};

export const CARD_TYPE_DEFINITIONS: Record<SmartCardType, CardTypeDefinition> = {
  invoice: INVOICE_CARD,
  order: ORDER_CARD,
  ticket: TICKET_CARD,
  expense: EXPENSE_CARD,
  payment: PAYMENT_CARD,
  deal: DEAL_CARD,
  customer: CUSTOMER_CARD,
  product: PRODUCT_CARD,
};

export const ALL_CARD_TYPES: SmartCardType[] = [
  "invoice",
  "order",
  "ticket",
  "expense",
  "payment",
  "deal",
  "customer",
  "product",
];

export function getCardTypeDefinition(cardType: SmartCardType): CardTypeDefinition | null {
  return CARD_TYPE_DEFINITIONS[cardType] ?? null;
}

export function buildSmartCard(cardType: SmartCardType, row: EntityRow): SmartCard | null {
  const def = getCardTypeDefinition(cardType);
  if (!def) return null;
  return {
    cardType,
    entityId: row.id,
    snapshot: def.buildSnapshot(row),
    actions: def.getActions(row),
  };
}
