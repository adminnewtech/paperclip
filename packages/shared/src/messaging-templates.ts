// ---------------------------------------------------------------------------
// Built-in messaging templates (WhatsApp + SMS)
// ---------------------------------------------------------------------------
//
// Each template has Arabic and English versions. Variables use the
// `{{variableName}}` placeholder syntax. Renderers should substitute by
// straightforward string replacement.

export type MessageTemplateChannel = "whatsapp" | "sms" | "both";

export type MessageTemplateCategory =
  | "invoice"
  | "payment"
  | "ticket"
  | "delivery"
  | "marketing"
  | "general";

export interface MessageTemplate {
  key: string;
  name: string;
  nameAr: string;
  channel: MessageTemplateChannel;
  category: MessageTemplateCategory;
  /**
   * Variable names referenced inside `bodyEn`/`bodyAr` via `{{var}}`. Used by
   * the UI to render variable input fields.
   */
  variables: string[];
  bodyEn: string;
  bodyAr: string;
}

export const MESSAGE_TEMPLATES: readonly MessageTemplate[] = [
  {
    key: "invoice_sent",
    name: "Invoice sent",
    nameAr: "تم إرسال فاتورة جديدة",
    channel: "both",
    category: "invoice",
    variables: ["customerName", "invoiceCode", "amount", "currency", "dueDate"],
    bodyEn:
      "Hello {{customerName}}, your invoice {{invoiceCode}} for {{amount}} {{currency}} has been issued and is due on {{dueDate}}. Thank you for your business.",
    bodyAr:
      "مرحباً {{customerName}}، تم إصدار فاتورتك رقم {{invoiceCode}} بقيمة {{amount}} {{currency}} ومستحقة الدفع بتاريخ {{dueDate}}. شكراً لتعاملكم معنا.",
  },
  {
    key: "payment_due_reminder",
    name: "Payment due reminder",
    nameAr: "تذكير بدفع الفاتورة",
    channel: "both",
    category: "payment",
    variables: ["customerName", "invoiceCode", "amount", "currency", "dueDate"],
    bodyEn:
      "Hi {{customerName}}, this is a friendly reminder that invoice {{invoiceCode}} for {{amount}} {{currency}} is due on {{dueDate}}. Please arrange payment to avoid late fees.",
    bodyAr:
      "مرحباً {{customerName}}، هذا تذكير ودي بأن الفاتورة {{invoiceCode}} بقيمة {{amount}} {{currency}} مستحقة بتاريخ {{dueDate}}. يرجى إتمام الدفع لتجنب أي رسوم تأخير.",
  },
  {
    key: "payment_received",
    name: "Payment received",
    nameAr: "تم استلام الدفعة",
    channel: "both",
    category: "payment",
    variables: ["customerName", "amount", "currency", "invoiceCode"],
    bodyEn:
      "Thank you {{customerName}}! We've received your payment of {{amount}} {{currency}} for invoice {{invoiceCode}}. We appreciate your prompt payment.",
    bodyAr:
      "شكراً {{customerName}}! تم استلام دفعتك بقيمة {{amount}} {{currency}} عن الفاتورة {{invoiceCode}}. نقدر لكم سرعة السداد.",
  },
  {
    key: "quote_sent",
    name: "Quote sent",
    nameAr: "عرض السعر جاهز",
    channel: "both",
    category: "invoice",
    variables: ["customerName", "quoteCode", "amount", "currency", "validUntil"],
    bodyEn:
      "Hello {{customerName}}, your quote {{quoteCode}} for {{amount}} {{currency}} is ready and valid until {{validUntil}}. Let us know if you have any questions.",
    bodyAr:
      "مرحباً {{customerName}}، عرض السعر رقم {{quoteCode}} بقيمة {{amount}} {{currency}} جاهز وصالح حتى {{validUntil}}. نحن في الخدمة لأي استفسار.",
  },
  {
    key: "ticket_created",
    name: "Ticket created",
    nameAr: "تم استلام تذكرتك",
    channel: "both",
    category: "ticket",
    variables: ["customerName", "ticketCode", "subject"],
    bodyEn:
      "Hi {{customerName}}, we've received your support ticket {{ticketCode}}: \"{{subject}}\". Our team will get back to you shortly.",
    bodyAr:
      "مرحباً {{customerName}}، استلمنا تذكرة الدعم {{ticketCode}}: \"{{subject}}\". سيقوم فريقنا بالرد عليك في أقرب وقت.",
  },
  {
    key: "ticket_resolved",
    name: "Ticket resolved",
    nameAr: "تم حل التذكرة",
    channel: "both",
    category: "ticket",
    variables: ["customerName", "ticketCode"],
    bodyEn:
      "Hi {{customerName}}, your support ticket {{ticketCode}} has been resolved. If the issue persists, please reply to this message to reopen it.",
    bodyAr:
      "مرحباً {{customerName}}، تم حل تذكرة الدعم {{ticketCode}}. إذا استمرت المشكلة يرجى الرد على هذه الرسالة لإعادة فتحها.",
  },
  {
    key: "order_confirmed",
    name: "Order confirmed",
    nameAr: "تأكيد الطلب",
    channel: "both",
    category: "delivery",
    variables: ["customerName", "orderCode", "total", "currency"],
    bodyEn:
      "Thanks {{customerName}}! Your order {{orderCode}} for {{total}} {{currency}} has been confirmed. We'll let you know once it ships.",
    bodyAr:
      "شكراً {{customerName}}! تم تأكيد طلبك {{orderCode}} بقيمة {{total}} {{currency}}. سنخبرك حال شحنه.",
  },
  {
    key: "order_shipped",
    name: "Order shipped",
    nameAr: "تم شحن طلبك",
    channel: "both",
    category: "delivery",
    variables: ["customerName", "orderCode", "trackingNumber", "carrier"],
    bodyEn:
      "Good news {{customerName}}! Your order {{orderCode}} has shipped with {{carrier}}. Tracking number: {{trackingNumber}}.",
    bodyAr:
      "أخبار سارة {{customerName}}! تم شحن طلبك {{orderCode}} عبر {{carrier}}. رقم التتبع: {{trackingNumber}}.",
  },
  {
    key: "welcome_customer",
    name: "Welcome customer",
    nameAr: "مرحباً بك",
    channel: "both",
    category: "marketing",
    variables: ["customerName", "companyName"],
    bodyEn:
      "Welcome to {{companyName}}, {{customerName}}! We're thrilled to have you with us. Reply to this message any time you need help.",
    bodyAr:
      "أهلاً بك في {{companyName}}، {{customerName}}! سعداء بانضمامك إلينا. يمكنك الرد على هذه الرسالة في أي وقت تحتاج فيه المساعدة.",
  },
  {
    key: "birthday_offer",
    name: "Birthday offer",
    nameAr: "عرض بمناسبة عيد ميلادك",
    channel: "both",
    category: "marketing",
    variables: ["customerName", "discountPercent", "promoCode", "expiresOn"],
    bodyEn:
      "Happy birthday {{customerName}}! Enjoy {{discountPercent}}% off with code {{promoCode}}, valid until {{expiresOn}}. Have a wonderful day!",
    bodyAr:
      "كل عام وأنت بخير {{customerName}}! خصم {{discountPercent}}% باستخدام الرمز {{promoCode}}، ساري حتى {{expiresOn}}. نتمنى لك يوماً سعيداً!",
  },
];

export function getMessageTemplate(key: string): MessageTemplate | undefined {
  return MESSAGE_TEMPLATES.find((t) => t.key === key);
}

/**
 * Substitute `{{var}}` placeholders in `body` using `variables`. Missing
 * variables are left as-is so the caller can detect partially-filled templates.
 */
export function renderMessageTemplate(
  body: string,
  variables: Record<string, string>,
): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return variables[name] ?? "";
    }
    return `{{${name}}}`;
  });
}
