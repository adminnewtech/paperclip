/**
 * Business Agents catalog.
 *
 * Each agent is a specialized AI worker with a persona, skills, schedule, and
 * a set of modules it has access to. Companies can "hire" agents to manage
 * recurring business operations.
 *
 * Schedule strings reuse the shorthand expressions understood by the
 * business-automations scheduler ("daily"/"hourly"/"weekly"/"monthly" or a
 * 5-field cron expression).
 */

export type BusinessAgentSlug =
  | "accountant"
  | "sales"
  | "customer_service"
  | "inventory"
  | "marketing";

export type BusinessAgentSchedule = "daily" | "weekly" | "hourly" | "on_event";

export type BusinessAgentCapabilityTrigger =
  | "scheduled"
  | "on_create"
  | "on_demand";

export interface BusinessAgentCapability {
  /** Stable identifier (used in storage + run logs). */
  key: string;
  label: string;
  labelAr: string;
  description: string;
  trigger: BusinessAgentCapabilityTrigger;
}

export interface BusinessAgentDefinition {
  slug: BusinessAgentSlug;
  /** Role / job title in English. */
  name: string;
  /** Role / job title in Arabic. */
  nameAr: string;
  /** Persona first name (used in headings / chat). */
  personaName: string;
  personaNameAr: string;
  title: string;
  titleAr: string;
  /** Single-glyph visual identifier. */
  emoji: string;
  /** Hex color (used as the avatar background). */
  color: string;
  description: string;
  descriptionAr: string;
  responsibilities: string[];
  responsibilitiesAr: string[];
  /** Business modules the agent reads/writes. */
  modulesAccessed: string[];
  defaultSchedule: BusinessAgentSchedule;
  /** Default time-of-day for scheduled runs in HH:mm. */
  defaultRunTime: string;
  capabilities: BusinessAgentCapability[];
  /** Suggested monthly price in cents (display only). */
  monthlyCostCents: number;
}

export const BUSINESS_AGENTS: BusinessAgentDefinition[] = [
  // ---------------------------------------------------------------------------
  // 1. Accountant — Sara
  // ---------------------------------------------------------------------------
  {
    slug: "accountant",
    name: "Senior Accountant",
    nameAr: "محاسب أول",
    personaName: "Sara",
    personaNameAr: "سارة",
    title: "Senior Accountant",
    titleAr: "محاسب أول",
    emoji: "🧮",
    color: "#0EA5E9",
    description:
      "Keeps your books clean. Categorizes expenses, flags anomalies, reconciles invoices, and prepares VAT summaries — every day.",
    descriptionAr:
      "تحافظ على دفاترك نظيفة. تصنّف المصروفات، ترصد الشذوذات، تطابق الفواتير، وتجهز ملخص ضريبة القيمة المضافة يومياً.",
    responsibilities: [
      "Categorize uncategorized expenses every morning",
      "Detect duplicate expenses and flag for review",
      "Identify expense anomalies (>2x category average)",
      "Reconcile invoice payments against received funds",
      "Prepare a monthly VAT summary on the last day of each month",
    ],
    responsibilitiesAr: [
      "تصنيف المصروفات غير المصنفة كل صباح",
      "اكتشاف المصروفات المكررة والإبلاغ عنها",
      "تحديد المصروفات الشاذة (أكثر من ضعف متوسط الفئة)",
      "مطابقة دفعات الفواتير مع المبالغ المستلمة",
      "إعداد ملخص شهري لضريبة القيمة المضافة",
    ],
    modulesAccessed: ["finance", "sales"],
    defaultSchedule: "daily",
    defaultRunTime: "09:00",
    monthlyCostCents: 19_900_00,
    capabilities: [
      {
        key: "categorize_uncategorized_expenses",
        label: "Categorize uncategorized expenses",
        labelAr: "تصنيف المصروفات غير المصنفة",
        description:
          "Scans expenses missing a category and assigns one using AI (or rule-based heuristics if offline).",
        trigger: "scheduled",
      },
      {
        key: "detect_duplicate_expenses",
        label: "Detect duplicate expenses",
        labelAr: "اكتشاف المصروفات المكررة",
        description:
          "Finds expenses with matching vendor and amount within a short window.",
        trigger: "scheduled",
      },
      {
        key: "flag_expense_anomalies",
        label: "Flag expense anomalies",
        labelAr: "رصد المصروفات الشاذة",
        description:
          "Marks expenses larger than 2x their category average from the prior 90 days.",
        trigger: "scheduled",
      },
      {
        key: "prepare_vat_summary",
        label: "Prepare VAT summary",
        labelAr: "إعداد ملخص ضريبة القيمة المضافة",
        description:
          "Produces a month-to-date VAT summary covering output and input tax.",
        trigger: "scheduled",
      },
      {
        key: "reconcile_invoice_payments",
        label: "Reconcile invoice payments",
        labelAr: "مطابقة دفعات الفواتير",
        description:
          "Auto-marks invoices paid when matching payments exist and flags partial matches.",
        trigger: "scheduled",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 2. Sales — Khaled
  // ---------------------------------------------------------------------------
  {
    slug: "sales",
    name: "Sales Manager",
    nameAr: "مدير مبيعات",
    personaName: "Khaled",
    personaNameAr: "خالد",
    title: "Sales Manager",
    titleAr: "مدير مبيعات",
    emoji: "💼",
    color: "#22C55E",
    description:
      "Keeps your pipeline moving. Follows up on stale deals, nurtures cold leads, and drafts proposals — so nothing slips through the cracks.",
    descriptionAr:
      "يحافظ على تدفق المبيعات. يتابع الصفقات الراكدة، يهتم بالعملاء غير النشطين، ويصيغ العروض حتى لا تضيع أي فرصة.",
    responsibilities: [
      "Follow up on deals stuck >14 days in the same stage",
      "Nurture leads with no activity in 30+ days",
      "Suggest the next action for each open deal",
      "Re-prioritize the pipeline by closing probability",
      "Draft proposal emails for qualified deals",
    ],
    responsibilitiesAr: [
      "متابعة الصفقات الراكدة لأكثر من 14 يوماً في نفس المرحلة",
      "إعادة تفعيل العملاء المحتملين بدون نشاط لأكثر من 30 يوماً",
      "اقتراح الخطوة التالية لكل صفقة مفتوحة",
      "إعادة ترتيب أولويات المبيعات حسب احتمالية الإغلاق",
      "صياغة رسائل العروض للصفقات المؤهلة",
    ],
    modulesAccessed: ["crm", "sales"],
    defaultSchedule: "daily",
    defaultRunTime: "10:00",
    monthlyCostCents: 24_900_00,
    capabilities: [
      {
        key: "follow_up_stale_deals",
        label: "Follow up on stale deals",
        labelAr: "متابعة الصفقات الراكدة",
        description:
          "Logs a nudge activity for any deal that has not moved in 14+ days.",
        trigger: "scheduled",
      },
      {
        key: "nurture_cold_leads",
        label: "Nurture cold leads",
        labelAr: "إعادة تفعيل العملاء المحتملين",
        description:
          "Creates a touch-base activity for contacts with no activity in 30+ days.",
        trigger: "scheduled",
      },
      {
        key: "suggest_next_action",
        label: "Suggest next action per deal",
        labelAr: "اقتراح الخطوة التالية لكل صفقة",
        description:
          "For each active deal, records a suggested next action (call, email, demo).",
        trigger: "scheduled",
      },
      {
        key: "prioritize_pipeline",
        label: "Prioritize pipeline",
        labelAr: "ترتيب أولويات المبيعات",
        description: "Ranks active deals by stage probability × amount.",
        trigger: "scheduled",
      },
      {
        key: "draft_proposal_email",
        label: "Draft proposal email",
        labelAr: "صياغة رسالة العرض",
        description:
          "Drafts a proposal email for each deal in the Proposal stage that lacks one.",
        trigger: "scheduled",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 3. Customer Service — Layla
  // ---------------------------------------------------------------------------
  {
    slug: "customer_service",
    name: "Support Lead",
    nameAr: "قائد الدعم",
    personaName: "Layla",
    personaNameAr: "ليلى",
    title: "Customer Support Lead",
    titleAr: "قائد دعم العملاء",
    emoji: "🎧",
    color: "#A855F7",
    description:
      "Triages every inbound ticket within minutes. Classifies, prioritizes, drafts replies, and escalates SLA breaches.",
    descriptionAr:
      "تفرز كل تذكرة دعم خلال دقائق. تصنفها، تحدد أولويتها، تصيغ الرد، وتُصعّد عند انتهاك مستوى الخدمة.",
    responsibilities: [
      "Classify and prioritize new tickets every hour",
      "Auto-respond to simple FAQ-style tickets",
      "Escalate urgent tickets older than 2 hours",
      "Flag negative-sentiment messages for human review",
      "Suggest knowledge-base articles from resolved tickets",
    ],
    responsibilitiesAr: [
      "تصنيف وتحديد أولوية التذاكر الجديدة كل ساعة",
      "الرد التلقائي على الاستفسارات المتكررة",
      "تصعيد التذاكر العاجلة الأقدم من ساعتين",
      "وضع علامة على الرسائل ذات النبرة السلبية",
      "اقتراح مقالات لقاعدة المعرفة من التذاكر التي تم حلها",
    ],
    modulesAccessed: ["helpdesk", "crm"],
    defaultSchedule: "hourly",
    defaultRunTime: "00:00",
    monthlyCostCents: 17_900_00,
    capabilities: [
      {
        key: "classify_new_tickets",
        label: "Classify new tickets",
        labelAr: "تصنيف التذاكر الجديدة",
        description:
          "Categorizes each unclassified ticket and assigns a priority.",
        trigger: "scheduled",
      },
      {
        key: "auto_respond_simple_tickets",
        label: "Auto-respond to simple tickets",
        labelAr: "الرد التلقائي على التذاكر البسيطة",
        description:
          "Drafts a polite reply for tickets matching common FAQ patterns.",
        trigger: "scheduled",
      },
      {
        key: "escalate_sla_breaches",
        label: "Escalate SLA breaches",
        labelAr: "تصعيد انتهاكات مستوى الخدمة",
        description:
          "Tags urgent tickets open >2 hours as sla_breach and creates a tracking issue.",
        trigger: "scheduled",
      },
      {
        key: "flag_negative_sentiment",
        label: "Flag negative sentiment",
        labelAr: "رصد النبرة السلبية",
        description:
          "Highlights tickets containing strong negative language for manager review.",
        trigger: "scheduled",
      },
      {
        key: "update_knowledge_base",
        label: "Suggest knowledge-base articles",
        labelAr: "اقتراح مقالات قاعدة المعرفة",
        description:
          "Looks at recently resolved tickets and suggests reusable articles.",
        trigger: "scheduled",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 4. Inventory — Omar
  // ---------------------------------------------------------------------------
  {
    slug: "inventory",
    name: "Inventory Manager",
    nameAr: "مدير المخزون",
    personaName: "Omar",
    personaNameAr: "عمر",
    title: "Inventory Manager",
    titleAr: "مدير المخزون",
    emoji: "📦",
    color: "#F59E0B",
    description:
      "Watches your stock levels. Predicts reorder dates, drafts purchase orders, identifies dead stock, and suggests pricing tweaks.",
    descriptionAr:
      "يراقب مستويات المخزون. يتنبأ بتواريخ إعادة الطلب، يصيغ أوامر الشراء، يحدد المخزون الراكد، ويقترح تعديلات الأسعار.",
    responsibilities: [
      "Detect low-stock products before they sell out",
      "Predict reorder dates from sales velocity",
      "Draft suggested purchase orders for low-stock items",
      "Identify dead stock (no sales in 90+ days)",
      "Suggest pricing optimizations based on margin",
    ],
    responsibilitiesAr: [
      "اكتشاف المنتجات ذات المخزون المنخفض قبل نفادها",
      "التنبؤ بتواريخ إعادة الطلب من سرعة المبيعات",
      "صياغة أوامر شراء مقترحة للأصناف ذات المخزون المنخفض",
      "تحديد المخزون الراكد (بدون مبيعات لأكثر من 90 يوماً)",
      "اقتراح تحسينات للتسعير بناءً على هامش الربح",
    ],
    modulesAccessed: ["inventory", "sales"],
    defaultSchedule: "daily",
    defaultRunTime: "08:00",
    monthlyCostCents: 16_900_00,
    capabilities: [
      {
        key: "detect_low_stock",
        label: "Detect low stock",
        labelAr: "اكتشاف المخزون المنخفض",
        description:
          "Flags products at or below their reorder point.",
        trigger: "scheduled",
      },
      {
        key: "predict_reorder_dates",
        label: "Predict reorder dates",
        labelAr: "التنبؤ بتواريخ إعادة الطلب",
        description:
          "Estimates the days-until-stockout based on the last 30 days of sales.",
        trigger: "scheduled",
      },
      {
        key: "suggest_purchase_orders",
        label: "Suggest purchase orders",
        labelAr: "اقتراح أوامر الشراء",
        description:
          "Drafts a purchase order for any product below its reorder point.",
        trigger: "scheduled",
      },
      {
        key: "identify_dead_stock",
        label: "Identify dead stock",
        labelAr: "تحديد المخزون الراكد",
        description:
          "Flags products with no sales in the past 90 days.",
        trigger: "scheduled",
      },
      {
        key: "optimize_pricing",
        label: "Optimize pricing",
        labelAr: "تحسين التسعير",
        description:
          "Suggests price increases for high-velocity, low-margin products and discounts for slow movers.",
        trigger: "scheduled",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 5. Marketing — Mariam
  // ---------------------------------------------------------------------------
  {
    slug: "marketing",
    name: "Marketing Lead",
    nameAr: "قائد التسويق",
    personaName: "Mariam",
    personaNameAr: "مريم",
    title: "Marketing Lead",
    titleAr: "قائد التسويق",
    emoji: "📢",
    color: "#EC4899",
    description:
      "Designs your weekly marketing playbook. Generates campaign drafts, segments audiences, analyzes performance, and personalizes outreach.",
    descriptionAr:
      "تصمم خطة التسويق الأسبوعية. تنشئ مسودات الحملات، تقسم الجمهور، تحلل الأداء، وتخصص الرسائل.",
    responsibilities: [
      "Generate campaign drafts every Monday morning",
      "Segment audiences by behavior and value",
      "Analyze last week's campaign performance",
      "Propose a content calendar for the week",
      "Personalize outreach to top customers",
    ],
    responsibilitiesAr: [
      "إنشاء مسودات الحملات صباح كل اثنين",
      "تقسيم الجمهور حسب السلوك والقيمة",
      "تحليل أداء حملة الأسبوع الماضي",
      "اقتراح تقويم محتوى للأسبوع",
      "تخصيص التواصل مع أفضل العملاء",
    ],
    modulesAccessed: ["marketing", "crm", "sales"],
    defaultSchedule: "weekly",
    defaultRunTime: "09:00",
    monthlyCostCents: 22_900_00,
    capabilities: [
      {
        key: "generate_campaign_drafts",
        label: "Generate campaign drafts",
        labelAr: "إنشاء مسودات الحملات",
        description:
          "Creates a campaign entry tailored to the next 7 days of business activity.",
        trigger: "scheduled",
      },
      {
        key: "segment_audiences",
        label: "Segment audiences",
        labelAr: "تقسيم الجمهور",
        description:
          "Buckets contacts into VIP / Active / At-Risk / Cold segments.",
        trigger: "scheduled",
      },
      {
        key: "analyze_campaign_performance",
        label: "Analyze campaign performance",
        labelAr: "تحليل أداء الحملات",
        description:
          "Summarizes the previous week's campaigns and flags under-performers.",
        trigger: "scheduled",
      },
      {
        key: "suggest_content_calendar",
        label: "Suggest content calendar",
        labelAr: "اقتراح تقويم المحتوى",
        description:
          "Drafts a 7-day content calendar covering channels and themes.",
        trigger: "scheduled",
      },
      {
        key: "personalize_outreach",
        label: "Personalize outreach",
        labelAr: "تخصيص التواصل",
        description:
          "Drafts personalized outreach messages for the top revenue customers.",
        trigger: "scheduled",
      },
    ],
  },
];

export function getBusinessAgentDefinition(
  slug: string,
): BusinessAgentDefinition | undefined {
  return BUSINESS_AGENTS.find((a) => a.slug === slug);
}

export function listBusinessAgentDefinitions(): BusinessAgentDefinition[] {
  return BUSINESS_AGENTS.slice();
}
