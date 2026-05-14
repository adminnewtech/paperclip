/**
 * Smart-card action key constants.
 *
 * These keys identify the actions a user can invoke on a rendered smart card
 * (e.g. "Mark Paid" on an invoice card). The same keys are sent from the UI
 * back to the server `POST /workspace/cards/:type/:id/actions/:actionKey`
 * endpoint so the server can dispatch to the correct handler.
 *
 * Keep them in lock-step with `CARD_ACTION_HANDLERS` on the server.
 */

export const INVOICE_ACTIONS = {
  SEND_REMINDER: "send_reminder",
  MARK_PAID: "mark_paid",
  VIEW_PDF: "view_pdf",
  CANCEL: "cancel",
} as const;

export const ORDER_ACTIONS = {
  APPROVE: "approve",
  SHIP: "ship",
  CANCEL: "cancel",
  REFUND: "refund",
  VIEW_TRACKING: "view_tracking",
} as const;

export const TICKET_ACTIONS = {
  ASSIGN_TO_ME: "assign_to_me",
  ASSIGN_TO: "assign_to",
  CLOSE: "close",
  ESCALATE: "escalate",
  REPLY: "reply",
} as const;

export const EXPENSE_ACTIONS = {
  CATEGORIZE: "categorize",
  MARK_REIMBURSABLE: "mark_reimbursable",
  DELETE: "delete",
  VIEW_RECEIPT: "view_receipt",
} as const;

export const PAYMENT_ACTIONS = {
  LINK_TO_INVOICE: "link_to_invoice",
  REFUND: "refund",
  VIEW_RECEIPT: "view_receipt",
} as const;

export const DEAL_ACTIONS = {
  ADVANCE_STAGE: "advance_stage",
  MARK_WON: "mark_won",
  MARK_LOST: "mark_lost",
  ASSIGN_TO: "assign_to",
} as const;

export const CUSTOMER_ACTIONS = {
  VIEW_ORDERS: "view_orders",
  SEND_EMAIL: "send_email",
  SEND_WHATSAPP: "send_whatsapp",
  ADD_NOTE: "add_note",
} as const;

export const PRODUCT_ACTIONS = {
  UPDATE_PRICE: "update_price",
  UPDATE_STOCK: "update_stock",
  VIEW_SALES: "view_sales",
  TOGGLE_ACTIVE: "toggle_active",
} as const;

export const SMART_CARD_TYPES = [
  "invoice",
  "order",
  "ticket",
  "expense",
  "payment",
  "deal",
  "customer",
  "product",
] as const;

export type SmartCardTypeKey = (typeof SMART_CARD_TYPES)[number];

/** Per-card-type list of supported action keys (status-independent superset). */
export const ACTION_KEYS_BY_CARD_TYPE: Record<SmartCardTypeKey, readonly string[]> = {
  invoice: Object.values(INVOICE_ACTIONS),
  order: Object.values(ORDER_ACTIONS),
  ticket: Object.values(TICKET_ACTIONS),
  expense: Object.values(EXPENSE_ACTIONS),
  payment: Object.values(PAYMENT_ACTIONS),
  deal: Object.values(DEAL_ACTIONS),
  customer: Object.values(CUSTOMER_ACTIONS),
  product: Object.values(PRODUCT_ACTIONS),
};

export function isValidActionKey(cardType: SmartCardTypeKey, key: string): boolean {
  return ACTION_KEYS_BY_CARD_TYPE[cardType]?.includes(key) ?? false;
}
