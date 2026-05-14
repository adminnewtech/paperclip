// ---------------------------------------------------------------------------
// Built-in marketing flow templates
// ---------------------------------------------------------------------------
//
// Pre-built `MarketingFlow` payloads that operators can clone into their
// account with a single click. Each template references built-in message
// templates from `messaging-templates.ts` so they "just work" without any
// further setup.

export type FlowTriggerKind =
  | "schedule"
  | "entity_created"
  | "entity_status_changed"
  | "tag_added"
  | "manual";

export type FlowTrigger =
  | { kind: "schedule"; cron: string; tz?: string }
  | {
      kind: "entity_created";
      moduleKey: string;
      entityType: string;
      conditions?: Record<string, unknown>;
    }
  | {
      kind: "entity_status_changed";
      moduleKey: string;
      entityType: string;
      toStatus: string;
    }
  | { kind: "tag_added"; tag: string }
  | { kind: "manual" };

export interface FlowAudience {
  source: "all_contacts" | "tag" | "segment" | "filter";
  tag?: string;
  segment?: string;
  filter?: {
    field: string;
    op: "eq" | "neq" | "gt" | "lt" | "contains";
    value: unknown;
  };
}

export type FlowStepKind =
  | "send_message"
  | "wait"
  | "wait_until"
  | "branch"
  | "tag_contact"
  | "create_ticket"
  | "stop";

export type FlowStep =
  | {
      kind: "send_message";
      channel: "whatsapp" | "sms" | "email";
      templateKey: string;
      lang?: "ar" | "en";
    }
  | { kind: "wait"; durationHours: number }
  | { kind: "wait_until"; hourLocal: number; minuteLocal?: number }
  | {
      kind: "branch";
      condition: { field: string; op: string; value: unknown };
      then: FlowStep[];
      else: FlowStep[];
    }
  | { kind: "tag_contact"; tag: string }
  | { kind: "create_ticket"; subject: string; priority?: string }
  | { kind: "stop" };

export interface MarketingFlow {
  id: string;
  name: string;
  nameAr?: string;
  description?: string;
  enabled: boolean;
  trigger: FlowTrigger;
  audience: FlowAudience;
  steps: FlowStep[];
  stats: {
    enrolledCount: number;
    completedCount: number;
    messagesSentCount: number;
    deliveredCount: number;
    failedCount: number;
    revenueAttributedCents?: number;
  };
}

export interface FlowEnrollment {
  id: string;
  flowId: string;
  contactId: string;
  contactPhone?: string;
  contactEmail?: string;
  enrolledAt: string;
  currentStepIndex: number;
  nextRunAt?: string;
  status: "active" | "completed" | "paused" | "failed";
  history: Array<{
    stepIndex: number;
    ranAt: string;
    result: string;
    error?: string;
  }>;
}

export interface MarketingFlowTemplate {
  key: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  category: "welcome" | "retention" | "winback" | "promotion" | "transactional";
  defaultFlow: Omit<MarketingFlow, "id" | "stats" | "enabled">;
}

export const MARKETING_FLOW_TEMPLATES: readonly MarketingFlowTemplate[] = [
  {
    key: "welcome_series",
    name: "Welcome Series",
    nameAr: "سلسلة الترحيب",
    description:
      "Greet new contacts the moment they're created. Sends a welcome WhatsApp, waits 3 days, then sends a follow-up SMS with what to explore next.",
    descriptionAr:
      "رحب بالعملاء الجدد فور إضافتهم. رسالة ترحيب عبر واتساب، ثم بعد 3 أيام رسالة قصيرة تعرّف بأهم الميزات.",
    category: "welcome",
    defaultFlow: {
      name: "Welcome Series",
      nameAr: "سلسلة الترحيب",
      description: "New CRM contact onboarding sequence",
      trigger: {
        kind: "entity_created",
        moduleKey: "crm",
        entityType: "contact",
      },
      audience: { source: "all_contacts" },
      steps: [
        {
          kind: "send_message",
          channel: "whatsapp",
          templateKey: "welcome_customer",
          lang: "en",
        },
        { kind: "wait", durationHours: 72 },
        {
          kind: "send_message",
          channel: "sms",
          templateKey: "welcome_customer",
          lang: "en",
        },
        { kind: "stop" },
      ],
    },
  },
  {
    key: "abandoned_cart_recovery",
    name: "Abandoned Cart Recovery",
    nameAr: "استرجاع السلة المتروكة",
    description:
      "When an online order is marked abandoned, gently nudge after 1 hour. If still no purchase after 24h, send a 10% off code.",
    descriptionAr:
      "عند ترك سلة الشراء، أرسل تذكير لطيف بعد ساعة، ثم بعد 24 ساعة كود خصم 10% لاسترجاع الطلب.",
    category: "winback",
    defaultFlow: {
      name: "Abandoned Cart Recovery",
      nameAr: "استرجاع السلة المتروكة",
      description: "Re-engage shoppers who left without checking out",
      trigger: {
        kind: "entity_status_changed",
        moduleKey: "ecommerce",
        entityType: "online_order",
        toStatus: "abandoned",
      },
      audience: { source: "all_contacts" },
      steps: [
        { kind: "wait", durationHours: 1 },
        {
          kind: "send_message",
          channel: "whatsapp",
          templateKey: "order_confirmed",
          lang: "en",
        },
        { kind: "wait", durationHours: 24 },
        {
          kind: "send_message",
          channel: "sms",
          templateKey: "birthday_offer",
          lang: "en",
        },
        { kind: "tag_contact", tag: "cart_recovery_sent" },
        { kind: "stop" },
      ],
    },
  },
  {
    key: "post_purchase_followup",
    name: "Post-Purchase Follow-up",
    nameAr: "متابعة ما بعد الشراء",
    description:
      "After an order is delivered, wait 3 days and check satisfaction. Wait another 7 days and ask for a review.",
    descriptionAr:
      "بعد توصيل الطلب بـ3 أيام تواصل لقياس الرضا، ثم بعد 7 أيام اطلب تقييماً.",
    category: "retention",
    defaultFlow: {
      name: "Post-Purchase Follow-up",
      nameAr: "متابعة ما بعد الشراء",
      description: "Drive satisfaction and reviews after delivery",
      trigger: {
        kind: "entity_status_changed",
        moduleKey: "ecommerce",
        entityType: "online_order",
        toStatus: "delivered",
      },
      audience: { source: "all_contacts" },
      steps: [
        { kind: "wait", durationHours: 72 },
        {
          kind: "send_message",
          channel: "whatsapp",
          templateKey: "order_shipped",
          lang: "en",
        },
        { kind: "wait", durationHours: 168 },
        {
          kind: "send_message",
          channel: "sms",
          templateKey: "order_shipped",
          lang: "en",
        },
        { kind: "tag_contact", tag: "review_requested" },
        { kind: "stop" },
      ],
    },
  },
  {
    key: "birthday_campaign",
    name: "Birthday Campaign",
    nameAr: "حملة عيد الميلاد",
    description:
      "Every morning at 9am, find contacts whose birthday is today and send a personalised discount.",
    descriptionAr:
      "كل صباح الساعة 9 صباحاً نبحث عن العملاء الذين يحتفلون بأعياد ميلادهم اليوم ونرسل لهم عرضاً خاصاً.",
    category: "promotion",
    defaultFlow: {
      name: "Birthday Campaign",
      nameAr: "حملة عيد الميلاد",
      description: "Daily birthday offers via WhatsApp",
      trigger: { kind: "schedule", cron: "0 9 * * *" },
      audience: {
        source: "filter",
        filter: { field: "birthday_today", op: "eq", value: true },
      },
      steps: [
        {
          kind: "send_message",
          channel: "whatsapp",
          templateKey: "birthday_offer",
          lang: "en",
        },
        { kind: "tag_contact", tag: "birthday_offer_sent" },
        { kind: "stop" },
      ],
    },
  },
  {
    key: "winback_dormant",
    name: "Win-Back Dormant Customers",
    nameAr: "استعادة العملاء غير النشطين",
    description:
      "Weekly scan for contacts with no orders in 90+ days. Sends a 15% discount and tags them as targeted.",
    descriptionAr:
      "فحص أسبوعي للعملاء الذين لم يطلبوا منذ 90 يوم وأكثر، مع إرسال خصم 15%.",
    category: "winback",
    defaultFlow: {
      name: "Win-Back Dormant Customers",
      nameAr: "استعادة العملاء غير النشطين",
      description: "Reactivate customers who haven't bought in 90 days",
      trigger: { kind: "schedule", cron: "0 10 * * 1" },
      audience: {
        source: "filter",
        filter: { field: "lastOrderDaysAgo", op: "gt", value: 90 },
      },
      steps: [
        {
          kind: "send_message",
          channel: "whatsapp",
          templateKey: "birthday_offer",
          lang: "en",
        },
        { kind: "wait", durationHours: 72 },
        {
          kind: "send_message",
          channel: "sms",
          templateKey: "birthday_offer",
          lang: "en",
        },
        { kind: "tag_contact", tag: "winback_targeted" },
        { kind: "stop" },
      ],
    },
  },
  {
    key: "payment_reminder",
    name: "Payment Reminder",
    nameAr: "تذكير بالدفع",
    description:
      "When an invoice is sent, wait 7 days; if still unpaid send a reminder. After another 7 days, escalate with a helpdesk ticket.",
    descriptionAr:
      "عند إرسال الفاتورة وانتظار 7 أيام، إذا لم يتم الدفع نرسل تذكيراً. بعد 7 أيام أخرى تُفتح تذكرة في الدعم.",
    category: "transactional",
    defaultFlow: {
      name: "Payment Reminder",
      nameAr: "تذكير بالدفع",
      description: "Recover unpaid invoices through a 14-day cadence",
      trigger: {
        kind: "entity_status_changed",
        moduleKey: "sales",
        entityType: "invoice",
        toStatus: "sent",
      },
      audience: { source: "all_contacts" },
      steps: [
        { kind: "wait", durationHours: 168 },
        {
          kind: "branch",
          condition: { field: "status", op: "eq", value: "sent" },
          then: [
            {
              kind: "send_message",
              channel: "whatsapp",
              templateKey: "payment_due_reminder",
              lang: "en",
            },
            { kind: "wait", durationHours: 168 },
            {
              kind: "create_ticket",
              subject: "Escalated overdue invoice",
              priority: "high",
            },
          ],
          else: [{ kind: "stop" }],
        },
        { kind: "stop" },
      ],
    },
  },
];

export function getMarketingFlowTemplate(
  key: string,
): MarketingFlowTemplate | undefined {
  return MARKETING_FLOW_TEMPLATES.find((t) => t.key === key);
}
