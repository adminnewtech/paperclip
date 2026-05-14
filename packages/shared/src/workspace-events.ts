/**
 * Workspace event catalog.
 *
 * Defines all the business events that can be auto-broadcast into the
 * Phase 11 workspace channels. Each event has a stable key, a default
 * routing target (channel slug + category), bilingual rendering templates,
 * and an importance level used by the routing filter.
 *
 * Templates use {{varName}} interpolation. Variables are passed through
 * `BusinessEvent.variables` by the producer (e.g. the event-bridge service
 * translating a businessStream event).
 *
 * NOTE: This file is intentionally kept separate from P11-A's workspace.ts
 * type catalog (channels, messages, members) to avoid collisions while the
 * two phases are developed in parallel.
 */

export type BusinessEventCategory =
  | "sales"
  | "finance"
  | "support"
  | "operations"
  | "inventory"
  | "marketing"
  | "hr"
  | "agents"
  | "system"
  | "leadership";

export type BusinessEventImportance =
  | "info"
  | "notable"
  | "important"
  | "critical";

export type BusinessEventCardType =
  | "invoice"
  | "order"
  | "ticket"
  | "expense"
  | "payment"
  | "deal"
  | "customer"
  | "product"
  | "shipment";

export interface BusinessEventDefinition {
  /** Stable, snake_case identifier. */
  key: string;
  category: BusinessEventCategory;
  /** Default channel slug to post into. */
  defaultChannelSlug: string;
  /** Body template, English. */
  template: { en: string; ar: string };
  /** Single-glyph icon. */
  emoji: string;
  /** Optional card type the UI can render alongside the message. */
  cardType?: BusinessEventCardType;
  importance: BusinessEventImportance;
}

const CATEGORY_TO_CHANNEL: Record<BusinessEventCategory, string> = {
  sales: "sales",
  finance: "finance",
  support: "support",
  operations: "operations",
  inventory: "operations",
  marketing: "sales",
  hr: "operations",
  agents: "ai-team",
  system: "general",
  leadership: "leadership",
};

export const BUSINESS_EVENT_CATALOG: BusinessEventDefinition[] = [
  // ---------------------------------------------------------------------------
  // Finance / invoices
  // ---------------------------------------------------------------------------
  {
    key: "invoice_created",
    category: "finance",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.finance,
    emoji: "🧾",
    cardType: "invoice",
    importance: "notable",
    template: {
      en: "🧾 *Invoice created*: {{invoiceCode}} for {{customerName}} — {{amount}} {{currency}}",
      ar: "🧾 *تم إنشاء فاتورة*: {{invoiceCode}} للعميل {{customerName}} — {{amount}} {{currency}}",
    },
  },
  {
    key: "invoice_paid",
    category: "finance",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.finance,
    emoji: "💰",
    cardType: "invoice",
    importance: "important",
    template: {
      en: "💰 *Payment received*: {{amount}} {{currency}} for invoice {{invoiceCode}} from {{customerName}}",
      ar: "💰 *تم استلام دفعة*: {{amount}} {{currency}} للفاتورة {{invoiceCode}} من {{customerName}}",
    },
  },
  {
    key: "invoice_overdue",
    category: "finance",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.finance,
    emoji: "⏰",
    cardType: "invoice",
    importance: "important",
    template: {
      en: "⏰ *Invoice overdue*: {{invoiceCode}} ({{customerName}}) — {{amount}} {{currency}}, {{daysOverdue}} days late",
      ar: "⏰ *فاتورة متأخرة*: {{invoiceCode}} ({{customerName}}) — {{amount}} {{currency}}، متأخرة {{daysOverdue}} يوم",
    },
  },
  {
    key: "payment_received",
    category: "finance",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.finance,
    emoji: "💵",
    cardType: "payment",
    importance: "important",
    template: {
      en: "💵 *Payment*: {{amount}} {{currency}} from {{customerName}} via {{method}}",
      ar: "💵 *دفعة*: {{amount}} {{currency}} من {{customerName}} عبر {{method}}",
    },
  },

  // ---------------------------------------------------------------------------
  // Sales / orders
  // ---------------------------------------------------------------------------
  {
    key: "order_placed",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "🛒",
    cardType: "order",
    importance: "notable",
    template: {
      en: "🛒 *New order*: #{{orderCode}} from {{customerName}} — {{amount}} {{currency}}",
      ar: "🛒 *طلب جديد*: #{{orderCode}} من {{customerName}} — {{amount}} {{currency}}",
    },
  },
  {
    key: "order_shipped",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "🚚",
    cardType: "shipment",
    importance: "info",
    template: {
      en: "🚚 *Order shipped*: #{{orderCode}} to {{customerName}} (tracking {{tracking}})",
      ar: "🚚 *تم شحن الطلب*: #{{orderCode}} إلى {{customerName}} (التتبع {{tracking}})",
    },
  },
  {
    key: "order_delivered",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "📦",
    cardType: "order",
    importance: "info",
    template: {
      en: "📦 *Order delivered*: #{{orderCode}} to {{customerName}}",
      ar: "📦 *تم تسليم الطلب*: #{{orderCode}} إلى {{customerName}}",
    },
  },
  {
    key: "order_cancelled",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "❌",
    cardType: "order",
    importance: "notable",
    template: {
      en: "❌ *Order cancelled*: #{{orderCode}} ({{customerName}}) — {{reason}}",
      ar: "❌ *تم إلغاء الطلب*: #{{orderCode}} ({{customerName}}) — {{reason}}",
    },
  },
  {
    key: "order_refunded",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "↩️",
    cardType: "order",
    importance: "important",
    template: {
      en: "↩️ *Refund issued*: {{amount}} {{currency}} on order #{{orderCode}} for {{customerName}}",
      ar: "↩️ *تم إصدار استرداد*: {{amount}} {{currency}} على الطلب #{{orderCode}} للعميل {{customerName}}",
    },
  },

  // ---------------------------------------------------------------------------
  // Support / tickets
  // ---------------------------------------------------------------------------
  {
    key: "ticket_created",
    category: "support",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.support,
    emoji: "🎫",
    cardType: "ticket",
    importance: "notable",
    template: {
      en: "🎫 *New ticket*: {{ticketCode}} from {{customerName}} — {{subject}}",
      ar: "🎫 *تذكرة جديدة*: {{ticketCode}} من {{customerName}} — {{subject}}",
    },
  },
  {
    key: "ticket_assigned",
    category: "support",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.support,
    emoji: "👤",
    cardType: "ticket",
    importance: "info",
    template: {
      en: "👤 *Ticket assigned*: {{ticketCode}} → {{assigneeName}}",
      ar: "👤 *تم إسناد التذكرة*: {{ticketCode}} → {{assigneeName}}",
    },
  },
  {
    key: "ticket_resolved",
    category: "support",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.support,
    emoji: "✅",
    cardType: "ticket",
    importance: "info",
    template: {
      en: "✅ *Ticket resolved*: {{ticketCode}} ({{customerName}}) by {{resolverName}}",
      ar: "✅ *تم حل التذكرة*: {{ticketCode}} ({{customerName}}) بواسطة {{resolverName}}",
    },
  },
  {
    key: "ticket_sla_breached",
    category: "support",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.support,
    emoji: "🚨",
    cardType: "ticket",
    importance: "critical",
    template: {
      en: "🚨 *SLA breached*: ticket {{ticketCode}} from {{customerName}} open {{hoursOpen}}h",
      ar: "🚨 *انتهاك مستوى الخدمة*: التذكرة {{ticketCode}} من {{customerName}} مفتوحة {{hoursOpen}} ساعة",
    },
  },

  // ---------------------------------------------------------------------------
  // Finance / expenses
  // ---------------------------------------------------------------------------
  {
    key: "expense_added",
    category: "finance",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.finance,
    emoji: "💸",
    cardType: "expense",
    importance: "info",
    template: {
      en: "💸 *Expense recorded*: {{amount}} {{currency}} — {{vendorName}} ({{category}})",
      ar: "💸 *مصروف مسجل*: {{amount}} {{currency}} — {{vendorName}} ({{category}})",
    },
  },
  {
    key: "expense_anomaly_flagged",
    category: "finance",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.finance,
    emoji: "🚩",
    cardType: "expense",
    importance: "important",
    template: {
      en: "🚩 *Anomaly flagged*: expense {{amount}} {{currency}} ({{vendorName}}) is {{multiplier}}× the {{category}} average",
      ar: "🚩 *مصروف شاذ*: {{amount}} {{currency}} ({{vendorName}}) يبلغ {{multiplier}}× متوسط فئة {{category}}",
    },
  },

  // ---------------------------------------------------------------------------
  // Sales / deals
  // ---------------------------------------------------------------------------
  {
    key: "deal_created",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "🤝",
    cardType: "deal",
    importance: "info",
    template: {
      en: "🤝 *New deal*: {{dealName}} ({{customerName}}) — {{amount}} {{currency}}",
      ar: "🤝 *صفقة جديدة*: {{dealName}} ({{customerName}}) — {{amount}} {{currency}}",
    },
  },
  {
    key: "deal_stage_changed",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "🔀",
    cardType: "deal",
    importance: "info",
    template: {
      en: "🔀 *Deal stage*: {{dealName}} moved {{fromStage}} → {{toStage}}",
      ar: "🔀 *مرحلة الصفقة*: {{dealName}} انتقلت من {{fromStage}} إلى {{toStage}}",
    },
  },
  {
    key: "deal_won",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "🎉",
    cardType: "deal",
    importance: "important",
    template: {
      en: "🎉 *Deal won*: {{dealName}} ({{customerName}}) — {{amount}} {{currency}}",
      ar: "🎉 *تم كسب الصفقة*: {{dealName}} ({{customerName}}) — {{amount}} {{currency}}",
    },
  },
  {
    key: "deal_lost",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "💔",
    cardType: "deal",
    importance: "notable",
    template: {
      en: "💔 *Deal lost*: {{dealName}} ({{customerName}}) — reason: {{reason}}",
      ar: "💔 *خسرت الصفقة*: {{dealName}} ({{customerName}}) — السبب: {{reason}}",
    },
  },

  // ---------------------------------------------------------------------------
  // HR / contacts
  // ---------------------------------------------------------------------------
  {
    key: "contact_added",
    category: "sales",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.sales,
    emoji: "👋",
    cardType: "customer",
    importance: "info",
    template: {
      en: "👋 *New contact*: {{contactName}} ({{contactEmail}}) added by {{addedBy}}",
      ar: "👋 *جهة اتصال جديدة*: {{contactName}} ({{contactEmail}}) أضافها {{addedBy}}",
    },
  },
  {
    key: "employee_added",
    category: "hr",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.hr,
    emoji: "🧑‍💼",
    importance: "notable",
    template: {
      en: "🧑‍💼 *New employee*: {{employeeName}} joined as {{role}}",
      ar: "🧑‍💼 *موظف جديد*: انضم {{employeeName}} بصفة {{role}}",
    },
  },
  {
    key: "employee_birthday",
    category: "hr",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.hr,
    emoji: "🎂",
    importance: "info",
    template: {
      en: "🎂 *Birthday today*: {{employeeName}} — wish them well!",
      ar: "🎂 *عيد ميلاد اليوم*: {{employeeName}} — تمنوا لهم التوفيق!",
    },
  },

  // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------
  {
    key: "product_low_stock",
    category: "inventory",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.inventory,
    emoji: "📉",
    cardType: "product",
    importance: "notable",
    template: {
      en: "📉 *Low stock*: {{productName}} at {{quantity}} units (reorder point {{reorderPoint}})",
      ar: "📉 *مخزون منخفض*: {{productName}} عند {{quantity}} وحدة (نقطة إعادة الطلب {{reorderPoint}})",
    },
  },
  {
    key: "product_out_of_stock",
    category: "inventory",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.inventory,
    emoji: "🛑",
    cardType: "product",
    importance: "critical",
    template: {
      en: "🛑 *Out of stock*: {{productName}} — sales may stall",
      ar: "🛑 *نفاد المخزون*: {{productName}} — قد تتعطل المبيعات",
    },
  },

  // ---------------------------------------------------------------------------
  // Marketing
  // ---------------------------------------------------------------------------
  {
    key: "campaign_launched",
    category: "marketing",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.marketing,
    emoji: "📣",
    importance: "notable",
    template: {
      en: "📣 *Campaign launched*: {{campaignName}} targeting {{audienceSize}} contacts",
      ar: "📣 *تم إطلاق حملة*: {{campaignName}} تستهدف {{audienceSize}} جهة اتصال",
    },
  },
  {
    key: "campaign_milestone",
    category: "marketing",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.marketing,
    emoji: "🏁",
    importance: "info",
    template: {
      en: "🏁 *Campaign milestone*: {{campaignName}} hit {{metric}} = {{value}}",
      ar: "🏁 *إنجاز للحملة*: {{campaignName}} حققت {{metric}} = {{value}}",
    },
  },

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------
  {
    key: "agent_hired",
    category: "agents",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.agents,
    emoji: "🎯",
    importance: "notable",
    template: {
      en: "🎯 *Agent hired*: {{agentName}} — {{role}}",
      ar: "🎯 *تم تعيين وكيل*: {{agentName}} — {{role}}",
    },
  },
  {
    key: "agent_action_taken",
    category: "agents",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.agents,
    emoji: "⚙️",
    importance: "info",
    template: {
      en: "⚙️ *{{agentName}}* {{summary}}",
      ar: "⚙️ *{{agentName}}* {{summary}}",
    },
  },
  {
    key: "agent_needs_attention",
    category: "agents",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.agents,
    emoji: "🙋",
    importance: "important",
    template: {
      en: "🙋 *{{agentName}} needs attention*: {{reason}}",
      ar: "🙋 *{{agentName}} يحتاج إلى مساعدة*: {{reason}}",
    },
  },

  // ---------------------------------------------------------------------------
  // Health score
  // ---------------------------------------------------------------------------
  {
    key: "health_score_changed",
    category: "leadership",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.leadership,
    emoji: "📊",
    importance: "info",
    template: {
      en: "📊 *Health score*: {{from}} → {{to}} ({{delta}})",
      ar: "📊 *مؤشر الصحة*: {{from}} → {{to}} ({{delta}})",
    },
  },
  {
    key: "health_score_critical",
    category: "leadership",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.leadership,
    emoji: "🚨",
    importance: "critical",
    template: {
      en: "🚨 *Health score critical*: down to {{score}} — {{reason}}",
      ar: "🚨 *مؤشر الصحة في وضع حرج*: انخفض إلى {{score}} — {{reason}}",
    },
  },

  // ---------------------------------------------------------------------------
  // System / reports
  // ---------------------------------------------------------------------------
  {
    key: "daily_brief",
    category: "leadership",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.leadership,
    emoji: "🌅",
    importance: "info",
    template: {
      en: "🌅 *Daily brief*: {{summary}}",
      ar: "🌅 *الموجز اليومي*: {{summary}}",
    },
  },
  {
    key: "weekly_report",
    category: "leadership",
    defaultChannelSlug: CATEGORY_TO_CHANNEL.leadership,
    emoji: "📅",
    importance: "notable",
    template: {
      en: "📅 *Weekly report*: revenue {{revenue}} {{currency}}, deals {{deals}}, tickets {{tickets}}",
      ar: "📅 *التقرير الأسبوعي*: الإيرادات {{revenue}} {{currency}}، الصفقات {{deals}}، التذاكر {{tickets}}",
    },
  },
];

const EVENT_INDEX = new Map<string, BusinessEventDefinition>(
  BUSINESS_EVENT_CATALOG.map((e) => [e.key, e]),
);

export function getBusinessEventDefinition(
  key: string,
): BusinessEventDefinition | undefined {
  return EVENT_INDEX.get(key);
}

export function listBusinessEventDefinitions(): BusinessEventDefinition[] {
  return BUSINESS_EVENT_CATALOG.slice();
}

/**
 * Render a template by substituting {{var}} placeholders. Unknown variables
 * are kept as-is so producers/operators can spot typos in the UI.
 */
export function renderBusinessEventTemplate(
  template: string,
  variables: Record<string, string | number>,
): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) => {
    const value = variables[name];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

/** Ordered list of importance values for >= comparisons. */
export const BUSINESS_EVENT_IMPORTANCE_ORDER: BusinessEventImportance[] = [
  "info",
  "notable",
  "important",
  "critical",
];

export function compareBusinessEventImportance(
  a: BusinessEventImportance,
  b: BusinessEventImportance,
): number {
  return (
    BUSINESS_EVENT_IMPORTANCE_ORDER.indexOf(a) -
    BUSINESS_EVENT_IMPORTANCE_ORDER.indexOf(b)
  );
}
